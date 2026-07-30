// src/services/registral/importacao.ts
//
// IMPORTAÇÃO DE CERTIDÕES PELA ÁRVORE — construção automática da genealogia.
//
// O que este módulo entrega: o operador joga um punhado de fotos e PDFs
// escaneados na tela da Árvore e recebe de volta uma ÁRVORE PROPOSTA inteira —
// pessoas, filiações, casamentos, cada dado com a certidão que o sustenta — para
// conferir e aprovar de uma vez. Não existe cadastro nó por nó.
//
// DUAS FASES, e a razão é o modelo de dados:
//
//   `Documento.pessoaId` é obrigatório. Só se sabe de quem é a certidão depois de
//   lê-la, e criar o registro antes da leitura obrigaria a pendurá-lo numa pessoa
//   provisória — documento no dossiê errado, ainda que por um instante, num
//   sistema que existe para ser auditável.
//
//   ANALISAR  → lê (visão), classifica, extrai duas vezes, confere, agrupa
//               identidades entre TODOS os documentos do lote, resolve contra a
//               árvore que já existe e monta a proposta. Zero escrita.
//   CONFIRMAR → numa transação: cria as pessoas aprovadas, aplica os campos
//               aprovados, amarra filiações e uniões, grava os documentos na
//               Pasta Documental existente e roda o motor registral.
//   REVERTER  → desfaz a importação inteira a partir do registro de auditoria.
//
// COMO A ÁRVORE SE MONTA SOZINHA
// ------------------------------
// Cada certidão produz OCORRÊNCIAS (registrado, pai, mãe, cônjuge, avós). As
// ocorrências de TODOS os documentos são agrupadas por identidade — a mesma
// pessoa citada em três certidões vira um nó só — e cada nó é confrontado com a
// árvore existente. O que o documento afirma como vínculo vira aresta entre nós.
// O resultado é a árvore proposta; o operador só toca no que ficou duvidoso.
//
// O QUE NUNCA ACONTECE AQUI
// -------------------------
// · escolher silenciosamente entre duas leituras que discordam (o campo trava);
// · sobrescrever dado existente sem o operador ver o antes e o depois;
// · gravar filiação contraditória (dois pais para a mesma pessoa) sem revisão;
// · fundir duas pessoas automaticamente;
// · criar armazenamento paralelo — o arquivo vive no storage do projeto e o
//   registro vive em `Documento`, como qualquer outro documento do processo.

import { prisma } from "@/lib/prisma"
import { Prisma } from "@prisma/client"
import { classificarDocumento } from "@/src/lib/genealogia/registral/classificador"
import { conferir, montarOcorrencias } from "@/src/lib/genealogia/registral/conferencia"
import { extrairAncorado } from "@/src/lib/genealogia/registral/extracao-ancorada"
import { extrairEstrutural } from "@/src/lib/genealogia/registral/extracao-estrutural"
import { resolverIdentidade } from "@/src/lib/genealogia/registral/identidade"
import { normalizarNome } from "@/src/lib/genealogia/registral/normalizacao"
import { ROTULO_CAMPO } from "@/src/lib/genealogia/registral/campos"
import type {
  CampoConferido,
  LeituraDocumento,
  NaturezaRegistral,
  OcorrenciaExtraida,
  PapelOcorrencia,
  PessoaConhecida,
  ResultadoExtracao,
} from "@/src/lib/genealogia/registral/tipos"
import type { VinculoAfirmado } from "@/src/lib/genealogia/registral/visao"
import { auditar, logRegistral } from "./auditoria"
import { baixarArquivo, transcreverArquivo } from "./ocr"
import { criarLote, processarLote } from "./lote"
import { carregarContexto } from "./estado"
import { Orcamento, configVisao, situacaoDaVisao } from "./visao/cliente"
import { lerCertidaoDuasVezes } from "./visao/leitura"

// ============================================================================
// CONTRATOS
// ============================================================================

export interface ArquivoImportado {
  /** URL pública no storage do projeto (o upload já aconteceu). */
  url: string
  nome: string
  mimeType: string | null
  tamanho?: number | null
}

export interface Evidencia {
  documentoIndice: number
  documentoNome: string
  /** "visao_literal" | "visao_registral" | "ancora_rotulo" | … */
  leitura: string
  trecho: string | null
  pagina: number | null
  confianca: number
}

export interface CampoProposto {
  campo: string
  rotulo: string
  valor: string
  confianca: number
  /** true quando as leituras (ou dois documentos) discordaram: não é aplicável. */
  bloqueado: boolean
  explicacao: string
  evidencias: Evidencia[]
}

export interface Alteracao {
  campo: string
  rotulo: string
  antes: string | null
  depois: string
  tipo: "PREENCHE_VAZIO" | "ALTERA_EXISTENTE"
  /** O que a tela marca sozinha: preencher vazio sim, sobrescrever não. */
  aplicarPorPadrao: boolean
  evidencias: Evidencia[]
}

export interface NoProposto {
  chave: string
  nome: string
  sobrenome: string | null
  sexo: "M" | "F" | null
  /** Pessoa existente com que este nó casou. */
  pessoaId: number | null
  nova: boolean
  classe: string | null
  score: number | null
  motivoIdentidade: string
  papeis: PapelOcorrencia[]
  documentos: number[]
  /** Tudo que os documentos afirmam sobre esta pessoa. */
  dados: CampoProposto[]
  /** Antes → depois contra a pessoa já cadastrada (vazio quando é pessoa nova). */
  alteracoes: Alteracao[]
  /** Divergências que impedem aplicar automaticamente. */
  conflitos: string[]
  confianca: number
  /** Candidatos fracos ou ambíguos — evidência contrária, para o operador decidir. */
  outrosCandidatos: Array<{ pessoaId: number; nome: string; classe: string; score: number }>
  /**
   * Outros nós DESTE lote que podem ser a mesma pessoa, mas não com força
   * suficiente para o sistema juntar sozinho — tipicamente nome de casada
   * ("MARIA SOUZA" × "MARIA SOUZA BIANCHI") sem nenhum outro dado que confirme.
   * Juntar por conta própria seria fusão automática; o que se faz é oferecer.
   */
  possiveisDuplicatas: Array<{ chave: string; nome: string; classe: string; score: number }>
}

export interface VinculoProposto {
  tipo: "FILIACAO_PAI" | "FILIACAO_MAE" | "UNIAO"
  deChave: string
  paraChave: string
  jaExiste: boolean
  /** Preenchido quando aplicar o vínculo contrariaria o que já está na árvore. */
  conflito: string | null
  confianca: number
  documentos: number[]
  evidencias: Evidencia[]
}

export interface ArquivoAnalisado {
  indice: number
  nome: string
  url: string
  mimeType: string | null
  tipo: NaturezaRegistral
  confiancaTipo: number
  /** true quando as duas leituras discordaram do TIPO do documento. */
  tipoDivergente: boolean
  fonteLeitura: string | null
  legivel: boolean
  motivoIlegivel: string | null
  legibilidade: string | null
  problemasDeImagem: string[]
  /** Chave do nó que é o sujeito do documento — para onde ele vai no dossiê. */
  sujeitoChave: string | null
  campos: Array<{
    campo: string
    rotulo: string
    papel: PapelOcorrencia
    valor: string | null
    veredicto: string
    divergente: boolean
  }>
  divergencias: Array<{
    campo: string
    rotulo: string
    leituraA: string | null
    leituraB: string | null
    critica: boolean
    explicacao: string
  }>
  averbacoes: Array<{ texto: string; data?: string | null; tipo?: string | null }>
  necessidade: { id: number; item: string } | null
  transcricao: { paginas: Array<{ pagina: number; texto: string }>; fonte: string } | null
}

export interface ResultadoAnalise {
  processoId: number
  arvoreId: number | null
  arquivos: ArquivoAnalisado[]
  /** A ÁRVORE PROPOSTA: nós e arestas, prontos para desenhar e para aplicar. */
  nos: NoProposto[]
  vinculos: VinculoProposto[]
  resumo: {
    total: number
    legiveis: number
    ilegiveis: number
    pessoasNovas: number
    pessoasVinculadas: number
    vinculosNovos: number
    divergencias: number
    alteracoesEmDadosExistentes: number
    geracoes: number
  }
  leitura: {
    provedor: string
    modelo: string | null
    disponivel: boolean
    motivo: string | null
    custo: { chamadas: number; tokensEntrada: number; tokensSaida: number; custoUsd: number; tetoUsd: number } | null
  }
  avisos: string[]
}

// ============================================================================
// FASE 1 — ANALISAR (nenhuma escrita)
// ============================================================================

interface OcorrenciaDoLote {
  ocorrencia: OcorrenciaExtraida
  documentoIndice: number
  documentoNome: string
  campos: CampoConferido[]
  leituras: string[]
}

export async function analisarImportacao(p: {
  processoId: number
  arquivos: ArquivoImportado[]
  usuarioId?: number | null
}): Promise<ResultadoAnalise> {
  const ctx = await carregarContexto(prisma, p.processoId)
  const arvoreId = ctx?.arvoreId ?? null

  const candidatos = arvoreId != null ? await carregarPessoasDaArvore(arvoreId) : []
  const existentes = new Map(candidatos.map((c) => [c.id, c]))
  const necessidades =
    arvoreId != null
      ? await prisma.necessidadeDocumental.findMany({
          where: { processoId: p.processoId, status: { in: ["PENDENTE", "EM_ATENDIMENTO"] } },
          select: { id: true, pessoaId: true, itemCatalogo: { select: { code: true, name: true } } },
        })
      : []

  const visao = situacaoDaVisao()
  const cfg = configVisao()
  const orcamento = new Orcamento(cfg.tetoUsd)

  const analisados: ArquivoAnalisado[] = []
  const ocorrenciasDoLote: OcorrenciaDoLote[] = []
  const vinculosBrutos: Array<{ vinculo: VinculoAfirmado; documentoIndice: number; documentoNome: string }> = []
  const avisos = new Set<string>()
  if (!visao.disponivel && visao.motivo) avisos.add(visao.motivo)

  for (let i = 0; i < p.arquivos.length; i++) {
    const arquivo = p.arquivos[i]
    const base: ArquivoAnalisado = {
      indice: i,
      nome: arquivo.nome,
      url: arquivo.url,
      mimeType: arquivo.mimeType,
      tipo: "DESCONHECIDO",
      confiancaTipo: 0,
      tipoDivergente: false,
      fonteLeitura: null,
      legivel: false,
      motivoIlegivel: null,
      legibilidade: null,
      problemasDeImagem: [],
      sujeitoChave: null,
      campos: [],
      divergencias: [],
      averbacoes: [],
      necessidade: null,
      transcricao: null,
    }

    const download = await baixarArquivo(arquivo.url)
    if (!download.ok) {
      analisados.push({ ...base, motivoIlegivel: download.motivo })
      continue
    }

    const lido = await lerArquivo({
      arquivo,
      indice: i,
      conteudo: download.conteudo,
      visaoDisponivel: visao.disponivel,
      orcamento,
    })
    if (lido.aviso) avisos.add(lido.aviso)
    if (!lido.ok) {
      analisados.push({ ...base, motivoIlegivel: lido.motivo })
      continue
    }

    const conferencia = conferir(lido.a, lido.b, lido.natureza)
    const ocorrencias = montarOcorrencias(conferencia.campos, lido.natureza)

    for (const oc of ocorrencias) {
      ocorrenciasDoLote.push({
        ocorrencia: oc,
        documentoIndice: i,
        documentoNome: arquivo.nome,
        campos: conferencia.campos.filter((c) => c.papel === oc.papel),
        leituras: [lido.a.extrator, lido.b.extrator],
      })
    }
    for (const v of lido.vinculos) {
      vinculosBrutos.push({ vinculo: v, documentoIndice: i, documentoNome: arquivo.nome })
    }

    analisados.push({
      ...base,
      tipo: lido.natureza,
      confiancaTipo: lido.confiancaNatureza,
      tipoDivergente: lido.naturezaDivergente,
      fonteLeitura: lido.fonte,
      legivel: !conferencia.insuficiente,
      motivoIlegivel: conferencia.motivoInsuficiencia,
      legibilidade: lido.legibilidade,
      problemasDeImagem: lido.problemasDeImagem,
      campos: conferencia.campos
        .filter((c) => c.valorNormalizado || c.veredicto === "DIVERGENTE")
        .map((c) => ({
          campo: c.campo,
          rotulo: ROTULO_CAMPO[c.campo] ?? c.campo,
          papel: c.papel,
          valor: c.valorNormalizado,
          veredicto: c.veredicto,
          divergente: c.veredicto === "DIVERGENTE",
        })),
      divergencias: conferencia.campos
        .filter((c) => c.veredicto === "DIVERGENTE")
        .map((c) => ({
          campo: c.campo,
          rotulo: ROTULO_CAMPO[c.campo] ?? c.campo,
          leituraA: c.a?.valorNormalizado ?? null,
          leituraB: c.b?.valorNormalizado ?? null,
          critica: c.bloqueadoParaRevisao,
          explicacao: c.explicacao,
        })),
      averbacoes: lido.averbacoes,
      transcricao: { paginas: lido.transcricao, fonte: lido.fonte },
    })
  }

  // ---- a árvore proposta
  const { nos, chavePorDocumentoPapel } = agruparEmNos(ocorrenciasDoLote, candidatos, existentes, arvoreId)
  const vinculos = montarVinculos(vinculosBrutos, nos, chavePorDocumentoPapel, existentes)

  for (const a of analisados) {
    const chave = chavePorDocumentoPapel.get(`${a.indice}|REGISTRADO`) ?? null
    a.sujeitoChave = chave
    const no = nos.find((n) => n.chave === chave)
    a.necessidade = casarNecessidade(a.tipo, no?.pessoaId ?? null, necessidades)
  }

  const resumo = {
    total: analisados.length,
    legiveis: analisados.filter((a) => a.legivel).length,
    ilegiveis: analisados.filter((a) => !a.legivel).length,
    pessoasNovas: nos.filter((n) => n.nova).length,
    pessoasVinculadas: nos.filter((n) => !n.nova).length,
    vinculosNovos: vinculos.filter((v) => !v.jaExiste).length,
    divergencias: analisados.reduce((s, a) => s + a.divergencias.length, 0),
    alteracoesEmDadosExistentes: nos.reduce(
      (s, n) => s + n.alteracoes.filter((x) => x.tipo === "ALTERA_EXISTENTE").length,
      0,
    ),
    geracoes: contarGeracoes(nos, vinculos),
  }

  await auditar(prisma, {
    acao: "registral_importacao_analisada",
    entidade: "Processo",
    entidadeId: p.processoId,
    descricao: `Importação analisada: ${analisados.length} arquivo(s), ${resumo.legiveis} legível(is), ${nos.length} pessoa(s) na proposta.`,
    detalhes: {
      arquivos: analisados.length,
      legiveis: resumo.legiveis,
      nos: nos.length,
      vinculos: vinculos.length,
      divergencias: resumo.divergencias,
      leitura: visao.disponivel ? "anthropic_visao" : "camada_texto",
      custo: orcamento.resumo(),
    },
    usuarioId: p.usuarioId ?? null,
  })

  return {
    processoId: p.processoId,
    arvoreId,
    arquivos: analisados,
    nos,
    vinculos,
    resumo,
    leitura: {
      provedor: visao.disponivel ? "anthropic_visao" : "pdf_camada_texto",
      modelo: visao.disponivel ? visao.modelo : null,
      disponivel: visao.disponivel,
      motivo: visao.motivo,
      custo: visao.disponivel ? orcamento.resumo() : null,
    },
    avisos: [...avisos],
  }
}

// ---------------------------------------------------------------- leitura

interface ArquivoLido {
  ok: true
  natureza: NaturezaRegistral
  confiancaNatureza: number
  naturezaDivergente: boolean
  a: ResultadoExtracao
  b: ResultadoExtracao
  vinculos: VinculoAfirmado[]
  fonte: string
  legibilidade: string | null
  problemasDeImagem: string[]
  averbacoes: Array<{ texto: string; data?: string | null; tipo?: string | null }>
  transcricao: Array<{ pagina: number; texto: string }>
  aviso?: string
}

/**
 * Lê UM arquivo. A visão da Anthropic é o caminho PRINCIPAL — é o que faz
 * fotografia e PDF escaneado funcionarem. A camada de texto do PDF continua
 * existindo como caminho secundário para certidão digital (não custa nada e é
 * exata) e como último recurso quando a visão está desligada.
 */
async function lerArquivo(p: {
  arquivo: ArquivoImportado
  indice: number
  conteudo: Uint8Array
  visaoDisponivel: boolean
  orcamento: Orcamento
}): Promise<ArquivoLido | { ok: false; motivo: string; aviso?: string }> {
  if (p.visaoDisponivel) {
    const visual = await lerCertidaoDuasVezes(
      { nome: p.arquivo.nome, mimeType: p.arquivo.mimeType, conteudo: p.conteudo, referencia: `doc#${p.indice}` },
      p.orcamento,
    )
    if (visual.ok && visual.a && visual.b) {
      return {
        ok: true,
        natureza: visual.natureza,
        confiancaNatureza: visual.confiancaNatureza,
        naturezaDivergente: visual.naturezaDivergente,
        a: visual.a,
        b: visual.b,
        vinculos: visual.vinculos,
        fonte: "anthropic_visao",
        legibilidade: visual.legibilidade,
        problemasDeImagem: visual.problemasDeImagem,
        averbacoes: visual.averbacoes,
        transcricao: visual.transcricao,
      }
    }
    // Visão falhou neste arquivo: ainda vale tentar a camada de texto (certidão
    // digital não precisa de visão), mas o motivo da falha vira aviso visível.
    const textual = await lerPelaCamadaDeTexto(p)
    if (textual.ok) return { ...textual, aviso: visual.motivo ?? undefined }
    return { ok: false, motivo: visual.motivo ?? textual.motivo }
  }

  const textual = await lerPelaCamadaDeTexto(p)
  const aviso =
    "A leitura visual está desligada (ANTHROPIC_API_KEY ausente): fotografias e PDFs escaneados não podem ser lidos."
  if (textual.ok) return { ...textual, aviso }
  return { ok: false, motivo: textual.motivo, aviso }
}

async function lerPelaCamadaDeTexto(p: {
  arquivo: ArquivoImportado
  indice: number
  conteudo: Uint8Array
}): Promise<ArquivoLido | { ok: false; motivo: string }> {
  const { resultado, tentativas } = await transcreverArquivo({
    nome: p.arquivo.nome,
    mimeType: p.arquivo.mimeType,
    conteudo: p.conteudo,
    referencia: p.indice,
  })
  if (!resultado) {
    return {
      ok: false,
      motivo:
        tentativas.map((t) => `${t.provedor}: ${t.motivo ?? "sem texto"}`).join(" · ") ||
        "Nenhum provedor sabe ler este arquivo.",
    }
  }
  const leitura: LeituraDocumento = {
    documentoId: 0,
    pessoaId: null,
    necessidadeId: null,
    itemCatalogoId: null,
    tipoDeclarado: null,
    paginas: resultado.paginas,
    literais: {},
    registral: null,
    estruturado: null,
    fonte: resultado.provedor,
  }
  const classificacao = classificarDocumento(leitura)
  return {
    ok: true,
    natureza: classificacao.natureza,
    confiancaNatureza: classificacao.confianca,
    naturezaDivergente: false,
    a: extrairAncorado(leitura, classificacao.natureza),
    b: extrairEstrutural(leitura, classificacao.natureza),
    vinculos: [],
    fonte: resultado.provedor,
    legibilidade: null,
    problemasDeImagem: [],
    averbacoes: [],
    transcricao: resultado.paginas,
  }
}

// ---------------------------------------------------------------- agrupamento em nós

/**
 * Agrupa as ocorrências de TODOS os documentos em nós de pessoa.
 *
 * Duas ocorrências viram o mesmo nó quando (a) casaram com a mesma pessoa já
 * cadastrada, ou (b) têm o mesmo nome normalizado. Quando existem DOIS candidatos
 * fortes na árvore — homônimos —, nenhum é escolhido: o nó nasce novo e os dois
 * aparecem como evidência contrária, para o operador decidir. Escolher sozinho
 * entre homônimos é o erro que produz árvore falsa e processo indeferido.
 */
function agruparEmNos(
  lote: OcorrenciaDoLote[],
  candidatos: PessoaConhecida[],
  existentes: Map<number, PessoaConhecida>,
  arvoreId: number | null,
): { nos: NoProposto[]; chavePorDocumentoPapel: Map<string, string> } {
  const nos = new Map<string, NoProposto>()
  const chavePorDocumentoPapel = new Map<string, string>()

  for (const item of lote) {
    const r = resolverIdentidade(item.ocorrencia, candidatos, { arvorePreferidaId: arvoreId })
    const fortes = r.correspondencias.filter(
      (c) => c.classe === "CORRESPONDENCIA_CONFIRMADA" || c.classe === "ALTAMENTE_PROVAVEL",
    )
    const ambiguo = fortes.length > 1
    const melhor = r.correspondencias[0] ?? null
    const pessoaId = fortes.length === 1 ? fortes[0].pessoaId : null

    // Sem correspondência no cadastro: antes de abrir um nó novo, ver se algum nó
    // JÁ MONTADO neste lote é a mesma pessoa. É aqui que "MARIA SOUZA" da certidão
    // de nascimento e "MARIA SOUZA BIANCHI" da certidão de casamento viram uma
    // pessoa só — e é a MESMA regra de identidade do motor que decide, não uma
    // comparação de texto inventada para o caso.
    const equivalente = pessoaId != null ? { chave: null, possiveis: [] } : chaveDeNoEquivalente(item.ocorrencia, nos, arvoreId)
    const chave =
      pessoaId != null ? `p${pessoaId}` : (equivalente.chave ?? `n:${item.ocorrencia.nomeNormalizado}`)
    chavePorDocumentoPapel.set(`${item.documentoIndice}|${item.ocorrencia.papel}`, chave)

    const existente = pessoaId != null ? existentes.get(pessoaId) ?? null : null
    let no = nos.get(chave)
    if (!no) {
      no = criarNo(chave, item.ocorrencia, pessoaId, existente, melhor, r.explicacao, r.correspondencias, existentes)
      if (ambiguo) {
        no.conflitos.push(
          `Há ${fortes.length} pessoas parecidas na árvore (homônimos). O sistema não escolheu — indique qual é, ou confirme que é uma pessoa nova.`,
        )
      }
      no.possiveisDuplicatas = equivalente.possiveis
      nos.set(chave, no)
    }

    if (!no.papeis.includes(item.ocorrencia.papel)) no.papeis.push(item.ocorrencia.papel)
    if (!no.documentos.includes(item.documentoIndice)) no.documentos.push(item.documentoIndice)
    if (!no.sexo && item.ocorrencia.sexoInferido) {
      no.sexo = item.ocorrencia.sexoInferido === "M" ? "M" : item.ocorrencia.sexoInferido === "F" ? "F" : null
    }

    absorverCampos(no, item)
  }

  for (const no of nos.values()) {
    const existente = no.pessoaId != null ? existentes.get(no.pessoaId) ?? null : null
    no.alteracoes = existente ? diffContraExistente(no, existente) : []
    no.confianca = no.dados.length
      ? Math.min(1, no.dados.reduce((s, d) => s + d.confianca, 0) / no.dados.length)
      : 0.5
  }

  return { nos: [...nos.values()], chavePorDocumentoPapel }
}

/**
 * Um nó já montado neste lote é a mesma pessoa desta ocorrência?
 *
 * Reusa `resolverIdentidade` — a mesma função que compara com o cadastro — só que
 * os candidatos são os nós do próprio lote, convertidos para a forma que ela
 * espera. Isso dá de graça o que o motor já sabe fazer: variação de nome de
 * casada, grafia divergente, abreviatura histórica, e a recusa de escolher quando
 * há mais de um candidato forte.
 */
function chaveDeNoEquivalente(
  oc: OcorrenciaExtraida,
  nos: Map<string, NoProposto>,
  arvoreId: number | null,
): { chave: string | null; possiveis: Array<{ chave: string; nome: string; classe: string; score: number }> } {
  const chaves: string[] = []
  const candidatos: PessoaConhecida[] = []
  let sintetico = 0
  for (const [chave, no] of nos) {
    // Nó que casou com pessoa cadastrada já foi tratado pelo caminho normal.
    if (no.pessoaId != null) continue
    const valor = (campo: string) => no.dados.find((d) => d.campo === campo && !d.bloqueado)?.valor ?? null
    chaves.push(chave)
    candidatos.push({
      id: ++sintetico,
      nome: no.nome,
      sobrenome: no.sobrenome,
      sexo: no.sexo,
      cpf: null,
      data_nasc: valor("DATA_NASCIMENTO"),
      data_obito: valor("DATA_OBITO"),
      local_nasc: valor("LOCAL_NASCIMENTO"),
      pais_nasc: valor("PAIS_NASCIMENTO"),
      profissao: valor("PROFISSAO"),
      paiId: null,
      maeId: null,
      nomePai: null,
      nomeMae: null,
      arvoreId,
      aliases: [],
      conjugesIds: [],
    })
  }
  if (candidatos.length === 0) return { chave: null, possiveis: [] }

  const r = resolverIdentidade(oc, candidatos, { arvorePreferidaId: arvoreId })
  const fortes = r.correspondencias.filter(
    (c) => c.classe === "CORRESPONDENCIA_CONFIRMADA" || c.classe === "ALTAMENTE_PROVAVEL",
  )
  // Mais de um nó forte = ambiguidade dentro do próprio lote. Não funde.
  if (fortes.length === 1) return { chave: chaves[fortes[0].pessoaId - 1] ?? null, possiveis: [] }

  // Nada forte o bastante: NÃO junta, mas guarda o que era plausível para o
  // operador poder juntar com um clique.
  const possiveis = r.correspondencias
    .filter((c) => c.classe === "POSSIVEL" || c.classe === "ALTAMENTE_PROVAVEL")
    .slice(0, 3)
    .map((c) => {
      const chave = chaves[c.pessoaId - 1]
      const no = chave ? nos.get(chave) : undefined
      return {
        chave: chave ?? "",
        nome: no ? [no.nome, no.sobrenome].filter(Boolean).join(" ") : "",
        classe: c.classe,
        score: c.score,
      }
    })
    .filter((x) => x.chave)
  return { chave: null, possiveis }
}

function criarNo(
  chave: string,
  oc: OcorrenciaExtraida,
  pessoaId: number | null,
  existente: PessoaConhecida | null,
  melhor: { classe: string; score: number } | null,
  explicacao: string,
  correspondencias: Array<{ pessoaId: number; classe: string; score: number }>,
  existentes: Map<number, PessoaConhecida>,
): NoProposto {
  const partes = oc.nomeNormalizado.split(/\s+/)
  const nomeDe = (id: number): string => {
    const p = existentes.get(id)
    return p ? [p.nome, p.sobrenome].filter(Boolean).join(" ") : `#${id}`
  }
  return {
    chave,
    nome: existente ? existente.nome : partes[0] ?? oc.nomeNormalizado,
    sobrenome: existente ? existente.sobrenome ?? null : partes.slice(1).join(" ") || null,
    sexo: (oc.sexoInferido === "M" || oc.sexoInferido === "F" ? oc.sexoInferido : null) as "M" | "F" | null,
    pessoaId,
    nova: pessoaId == null,
    classe: melhor?.classe ?? null,
    score: melhor?.score ?? null,
    motivoIdentidade: explicacao,
    papeis: [],
    documentos: [],
    dados: [],
    alteracoes: [],
    conflitos: [],
    confianca: 0,
    outrosCandidatos: correspondencias
      .filter((c) => c.pessoaId !== pessoaId)
      .slice(0, 3)
      .map((c) => ({ pessoaId: c.pessoaId, nome: nomeDe(c.pessoaId), classe: c.classe, score: c.score })),
    possiveisDuplicatas: [],
  }
}

/** Junta os campos conferidos de uma ocorrência ao nó, acumulando evidência. */
function absorverCampos(no: NoProposto, item: OcorrenciaDoLote): void {
  for (const c of item.campos) {
    if (c.veredicto === "DIVERGENTE") {
      const aviso = `${ROTULO_CAMPO[c.campo] ?? c.campo}: ${c.explicacao}`
      if (!no.conflitos.includes(aviso)) no.conflitos.push(aviso)
      continue
    }
    if (!c.valorNormalizado) continue

    const evidencia: Evidencia = {
      documentoIndice: item.documentoIndice,
      documentoNome: item.documentoNome,
      leitura: c.a?.metodo ?? c.b?.metodo ?? item.leituras[0],
      trecho: c.a?.trecho ?? c.b?.trecho ?? null,
      pagina: c.a?.pagina ?? c.b?.pagina ?? null,
      confianca: c.confianca,
    }

    const existente = no.dados.find((d) => d.campo === c.campo)
    if (!existente) {
      no.dados.push({
        campo: c.campo,
        rotulo: ROTULO_CAMPO[c.campo] ?? c.campo,
        valor: c.valorNormalizado,
        confianca: c.confianca,
        bloqueado: c.bloqueadoParaRevisao,
        explicacao: c.explicacao,
        evidencias: [evidencia],
      })
      continue
    }

    existente.evidencias.push(evidencia)
    if (existente.valor === c.valorNormalizado) {
      // Duas certidões dizendo o mesmo: a confiança sobe, mas nunca chega a 1 por
      // acumulação — documento repetido não é prova nova.
      existente.confianca = Math.min(0.99, existente.confianca + (1 - existente.confianca) * 0.4)
      continue
    }
    // Duas certidões dizendo coisas diferentes do MESMO campo: conflito
    // documental. Trava o campo em vez de eleger um vencedor.
    existente.bloqueado = true
    existente.explicacao = `Documentos discordam: "${existente.valor}" × "${c.valorNormalizado}".`
    const aviso = `${existente.rotulo}: documentos discordam ("${existente.valor}" × "${c.valorNormalizado}").`
    if (!no.conflitos.includes(aviso)) no.conflitos.push(aviso)
  }
}

/** Campo registral → coluna de `Pessoa`. Só o que a árvore realmente guarda. */
const CAMPO_PARA_COLUNA: Record<string, string> = {
  SEXO: "sexo",
  DATA_NASCIMENTO: "data_nasc",
  DATA_OBITO: "data_obito",
  LOCAL_NASCIMENTO: "local_nasc",
  PAIS_NASCIMENTO: "pais_nasc",
  PROFISSAO: "profissao",
}

function valorAtual(fonte: Record<string, unknown>, coluna: string): string | null {
  const v = fonte[coluna]
  if (v == null) return null
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  if (typeof v === "string") return v.trim() || null
  return String(v)
}

function diffContraExistente(no: NoProposto, existente: PessoaConhecida): Alteracao[] {
  const out: Alteracao[] = []
  for (const dado of no.dados) {
    const coluna = CAMPO_PARA_COLUNA[dado.campo]
    if (!coluna || dado.bloqueado) continue
    const antes = valorAtual(existente as unknown as Record<string, unknown>, coluna)
    if (antes === dado.valor) continue
    out.push({
      campo: dado.campo,
      rotulo: dado.rotulo,
      antes,
      depois: dado.valor,
      tipo: antes == null ? "PREENCHE_VAZIO" : "ALTERA_EXISTENTE",
      // Preencher vazio é ganho puro. Sobrescrever o que já existe é decisão do
      // operador, sempre — mesmo com certidão na mão.
      aplicarPorPadrao: antes == null,
      evidencias: dado.evidencias,
    })
  }
  return out
}

// ---------------------------------------------------------------- vínculos

function montarVinculos(
  brutos: Array<{ vinculo: VinculoAfirmado; documentoIndice: number; documentoNome: string }>,
  nos: NoProposto[],
  chavePorDocumentoPapel: Map<string, string>,
  existentes: Map<number, PessoaConhecida>,
): VinculoProposto[] {
  const porNomeNormalizado = new Map<string, string>()
  for (const n of nos) {
    const norm = normalizarNome([n.nome, n.sobrenome].filter(Boolean).join(" "))?.completo
    if (norm && !porNomeNormalizado.has(norm)) porNomeNormalizado.set(norm, n.chave)
  }

  /** Acha o nó de um nome dentro de um documento: papel primeiro, nome depois. */
  const achar = (nome: string, documentoIndice: number, papel: PapelOcorrencia): string | null =>
    chavePorDocumentoPapel.get(`${documentoIndice}|${papel}`) ?? porNomeNormalizado.get(nome) ?? null

  const papelDeOrigem = (v: VinculoAfirmado, nome: string, doc: number): PapelOcorrencia | null => {
    // Qual papel, dentro do documento, corresponde a quem RECEBE o vínculo.
    for (const papel of ["REGISTRADO", "PAI", "MAE", "CONJUGE"] as PapelOcorrencia[]) {
      const chave = chavePorDocumentoPapel.get(`${doc}|${papel}`)
      if (!chave) continue
      const no = nos.find((n) => n.chave === chave)
      if (!no) continue
      const norm = normalizarNome([no.nome, no.sobrenome].filter(Boolean).join(" "))?.completo
      if (norm === nome) return papel
    }
    return v.tipo === "UNIAO" ? "REGISTRADO" : null
  }

  const mapa = new Map<string, VinculoProposto>()

  for (const b of brutos) {
    const v = b.vinculo
    const origem = papelDeOrigem(v, v.de, b.documentoIndice)
    const deChave = origem
      ? achar(v.de, b.documentoIndice, origem)
      : (porNomeNormalizado.get(v.de) ?? null)
    const paraChave = achar(v.para, b.documentoIndice, v.papelDestino)
    if (!deChave || !paraChave || deChave === paraChave) continue

    const tipo: VinculoProposto["tipo"] =
      v.tipo === "UNIAO" ? "UNIAO" : v.papelDestino === "PAI" ? "FILIACAO_PAI" : "FILIACAO_MAE"
    const chave = `${tipo}|${deChave}|${paraChave}`

    const evidencia: Evidencia = {
      documentoIndice: b.documentoIndice,
      documentoNome: b.documentoNome,
      leitura: "visao_registral",
      trecho: null,
      pagina: null,
      confianca: v.confianca,
    }

    const atual = mapa.get(chave)
    if (atual) {
      atual.evidencias.push(evidencia)
      if (!atual.documentos.includes(b.documentoIndice)) atual.documentos.push(b.documentoIndice)
      atual.confianca = Math.min(0.99, atual.confianca + (1 - atual.confianca) * 0.3)
      continue
    }

    const deNo = nos.find((n) => n.chave === deChave)
    const paraNo = nos.find((n) => n.chave === paraChave)
    const { jaExiste, conflito } = situacaoDoVinculo(tipo, deNo, paraNo, existentes)

    mapa.set(chave, {
      tipo,
      deChave,
      paraChave,
      jaExiste,
      conflito,
      confianca: v.confianca,
      documentos: [b.documentoIndice],
      evidencias: [evidencia],
    })
  }

  return [...mapa.values()]
}

/**
 * O vínculo já existe? Ele contraria o que está lá?
 *
 * Filiação diferente da cadastrada NÃO é aplicada em silêncio: vira conflito
 * explícito. Trocar o pai de alguém é a alteração mais destrutiva possível numa
 * árvore de cidadania — é ela que define a linha de transmissão.
 */
function situacaoDoVinculo(
  tipo: VinculoProposto["tipo"],
  de: NoProposto | undefined,
  para: NoProposto | undefined,
  existentes: Map<number, PessoaConhecida>,
): { jaExiste: boolean; conflito: string | null } {
  if (!de || !para || de.pessoaId == null) return { jaExiste: false, conflito: null }
  const pessoa = existentes.get(de.pessoaId)
  if (!pessoa) return { jaExiste: false, conflito: null }

  if (tipo === "UNIAO") {
    const jaCasados = para.pessoaId != null && (pessoa.conjugesIds ?? []).includes(para.pessoaId)
    return { jaExiste: jaCasados, conflito: null }
  }

  const atual = tipo === "FILIACAO_PAI" ? pessoa.paiId ?? null : pessoa.maeId ?? null
  if (atual == null) return { jaExiste: false, conflito: null }
  if (para.pessoaId != null && atual === para.pessoaId) return { jaExiste: true, conflito: null }

  const rotulo = tipo === "FILIACAO_PAI" ? "pai" : "mãe"
  const nome = [pessoa.nome, pessoa.sobrenome].filter(Boolean).join(" ")
  const atualNome = existentes.get(atual)
  return {
    jaExiste: false,
    conflito:
      `${nome} já tem ${rotulo} cadastrado (${atualNome ? [atualNome.nome, atualNome.sobrenome].filter(Boolean).join(" ") : `#${atual}`}). ` +
      `O documento aponta outro. Precisa de decisão humana.`,
  }
}

/** Profundidade da proposta — quantas gerações a importação alcançou sozinha. */
function contarGeracoes(nos: NoProposto[], vinculos: VinculoProposto[]): number {
  const pais = new Map<string, string[]>()
  for (const v of vinculos) {
    if (v.tipo === "UNIAO") continue
    const arr = pais.get(v.deChave) ?? []
    arr.push(v.paraChave)
    pais.set(v.deChave, arr)
  }
  const profundidade = (chave: string, visitados: Set<string>): number => {
    if (visitados.has(chave)) return 0
    visitados.add(chave)
    const acima = pais.get(chave) ?? []
    if (acima.length === 0) return 1
    return 1 + Math.max(...acima.map((x) => profundidade(x, visitados)))
  }
  let maior = 0
  for (const n of nos) maior = Math.max(maior, profundidade(n.chave, new Set()))
  return maior
}

// ---------------------------------------------------------------- apoio

async function carregarPessoasDaArvore(arvoreId: number): Promise<PessoaConhecida[]> {
  const linhas = await prisma.pessoa.findMany({
    where: { arvoreId },
    select: {
      id: true,
      nome: true,
      sobrenome: true,
      sexo: true,
      data_nasc: true,
      data_obito: true,
      local_nasc: true,
      pais_nasc: true,
      profissao: true,
      paiId: true,
      maeId: true,
      arvoreId: true,
      pai: { select: { nome: true, sobrenome: true } },
      mae: { select: { nome: true, sobrenome: true } },
      nomePessoas: { where: { ativo: true }, select: { nome: true, sobrenome: true, tipo: true } },
      unioesComoPessoa1: { select: { pessoa2Id: true } },
      unioesComoPessoa2: { select: { pessoa1Id: true } },
    },
    orderBy: { id: "asc" },
  })
  return linhas.map((p) => ({
    id: p.id,
    nome: p.nome,
    sobrenome: p.sobrenome,
    sexo: p.sexo,
    cpf: null,
    data_nasc: p.data_nasc,
    data_obito: p.data_obito,
    local_nasc: p.local_nasc,
    pais_nasc: p.pais_nasc,
    profissao: p.profissao,
    paiId: p.paiId,
    maeId: p.maeId,
    nomePai: p.pai ? [p.pai.nome, p.pai.sobrenome].filter(Boolean).join(" ") : null,
    nomeMae: p.mae ? [p.mae.nome, p.mae.sobrenome].filter(Boolean).join(" ") : null,
    arvoreId: p.arvoreId,
    aliases: p.nomePessoas.map((a) => ({ nome: a.nome, sobrenome: a.sobrenome, tipo: a.tipo })),
    conjugesIds: [
      ...p.unioesComoPessoa1.map((u) => u.pessoa2Id),
      ...p.unioesComoPessoa2.map((u) => u.pessoa1Id),
    ],
  }))
}

function casarNecessidade(
  natureza: NaturezaRegistral,
  pessoaId: number | null,
  necessidades: Array<{ id: number; pessoaId: number | null; itemCatalogo: { code: string | null; name: string } | null }>,
): { id: number; item: string } | null {
  if (pessoaId == null) return null
  const alvo =
    natureza === "NASCIMENTO" ? "NASC" : natureza === "CASAMENTO" ? "CASAM" : natureza === "OBITO" ? "OBITO" : null
  if (!alvo) return null
  const achada = necessidades.find(
    (n) =>
      n.pessoaId === pessoaId &&
      `${n.itemCatalogo?.code ?? ""} ${n.itemCatalogo?.name ?? ""}`.toUpperCase().includes(alvo),
  )
  return achada ? { id: achada.id, item: achada.itemCatalogo?.name ?? `item #${achada.id}` } : null
}

// ============================================================================
// FASE 2 — CONFIRMAR (uma transação, a árvore inteira)
// ============================================================================

export interface DecisaoNo {
  chave: string
  /** CRIAR = pessoa nova · VINCULAR = usar a pessoa indicada · IGNORAR = fora. */
  acao: "CRIAR" | "VINCULAR" | "IGNORAR"
  pessoaId?: number | null
  nome?: string | null
  sobrenome?: string | null
  /** Campos registrais que o operador autorizou aplicar. */
  camposAAplicar?: string[]
  /**
   * Chave de outro nó do lote que o operador declarou ser a MESMA pessoa
   * (tipicamente nome de casada). Os dois nós passam a apontar para uma pessoa
   * só. É sempre decisão humana: o sistema oferece, nunca junta sozinho.
   */
  mesmoQue?: string | null
}

export interface DecisaoVinculo {
  tipo: "FILIACAO_PAI" | "FILIACAO_MAE" | "UNIAO"
  deChave: string
  paraChave: string
  aplicar: boolean
}

export interface DecisaoDocumento {
  indice: number
  /** Nó a que o documento pertence. `null` usa o sujeito detectado. */
  pessoaChave?: string | null
  descartar?: boolean
}

export interface ResultadoConfirmacao {
  processoId: number
  /** Identificador da importação — é por ele que se reverte. */
  importacaoId: number
  documentosCriados: number[]
  pessoasCriadas: number[]
  pessoasAtualizadas: number[]
  vinculosCriados: number
  unioesCriadas: number[]
  descartados: number
  loteId: number | null
  propostas: number
  conflitos: number
  erros: Array<{ referencia: string; motivo: string }>
}

/** O que o rollback precisa saber para desfazer exatamente o que foi feito. */
interface RegistroReversao {
  processoId: number
  arvoreId: number
  documentos: number[]
  pessoas: number[]
  unioes: number[]
  /** Lote registral disparado por esta importação (preenchido após a transação). */
  loteId?: number | null
  /** Estado ANTERIOR das colunas alteradas, por pessoa. */
  camposAnteriores: Array<{ pessoaId: number; valores: Record<string, string | null> }>
  vinculosAnteriores: Array<{ pessoaId: number; paiId: number | null; maeId: number | null }>
}

export async function confirmarImportacao(p: {
  processoId: number
  arquivos: ArquivoImportado[]
  analise: ArquivoAnalisado[]
  nos: NoProposto[]
  vinculos: VinculoProposto[]
  decisoesNos: DecisaoNo[]
  decisoesVinculos: DecisaoVinculo[]
  decisoesDocumentos: DecisaoDocumento[]
  usuarioId?: number | null
}): Promise<ResultadoConfirmacao> {
  const ctx = await carregarContexto(prisma, p.processoId)
  const arvoreId = ctx?.arvoreId ?? null
  if (arvoreId == null) throw new Error("O processo não tem árvore vinculada.")

  const decisaoPorChave = new Map(p.decisoesNos.map((d) => [d.chave, d]))
  const noPorChave = new Map(p.nos.map((n) => [n.chave, n]))

  /**
   * Resolve "este nó é o mesmo que aquele" até a chave final. Com guarda de
   * ciclo: dois nós apontando um para o outro não podem travar a importação.
   */
  const canonica = (chave: string): string => {
    const vistos = new Set<string>()
    let atual = chave
    while (!vistos.has(atual)) {
      vistos.add(atual)
      const alvo = decisaoPorChave.get(atual)?.mesmoQue
      if (!alvo || !noPorChave.has(alvo) || alvo === atual) return atual
      atual = alvo
    }
    return atual
  }
  const tipoPorNatureza = await mapaDeTiposDocumentais()

  // A árvore inteira numa transação: ou a proposta aprovada entra completa, ou
  // não entra nada. Meia árvore é pior que nenhuma — perde-se justamente a
  // rastreabilidade de quem é filho de quem.
  const aplicado = await prisma.$transaction(
    async (tx) => {
      const reversao: RegistroReversao = {
        processoId: p.processoId,
        arvoreId,
        documentos: [],
        pessoas: [],
        unioes: [],
        camposAnteriores: [],
        vinculosAnteriores: [],
      }
      const erros: ResultadoConfirmacao["erros"] = []
      const pessoasAtualizadas = new Set<number>()
      const idPorChave = new Map<string, number>()
      let vinculosCriados = 0

      // ---- 1. pessoas
      for (const [chave, decisao] of decisaoPorChave) {
        if (decisao.acao === "IGNORAR") continue
        const no = noPorChave.get(chave)
        if (!no) {
          erros.push({ referencia: chave, motivo: "Nó não encontrado na análise." })
          continue
        }
        // Nó declarado como a mesma pessoa que outro: não cria ninguém; só
        // passa a apontar para o mesmo id (resolvido na ordem certa abaixo).
        if (canonica(chave) !== chave) continue
        if (decisao.acao === "VINCULAR") {
          const alvo = decisao.pessoaId ?? no.pessoaId
          if (alvo == null) {
            erros.push({ referencia: chave, motivo: "Vincular sem pessoa indicada." })
            continue
          }
          idPorChave.set(chave, alvo)
          continue
        }
        const nome = (decisao.nome ?? no.nome ?? "").trim()
        if (!nome) {
          erros.push({ referencia: chave, motivo: "Pessoa nova sem nome." })
          continue
        }
        const criada = await tx.pessoa.create({
          data: {
            nome: nome.slice(0, 50),
            sobrenome: ((decisao.sobrenome ?? no.sobrenome) || "").slice(0, 40) || null,
            sexo: no.sexo,
            arvoreId,
            linhaReta: false,
          },
          select: { id: true },
        })
        idPorChave.set(chave, criada.id)
        reversao.pessoas.push(criada.id)
      }

      // Os nós juntados herdam o id do nó canônico — a partir daqui, campos,
      // vínculos e documentos deles caem todos na mesma pessoa.
      for (const chave of decisaoPorChave.keys()) {
        if (idPorChave.has(chave)) continue
        const alvo = idPorChave.get(canonica(chave))
        if (alvo != null) idPorChave.set(chave, alvo)
      }

      // ---- 2. campos aprovados
      for (const [chave, decisao] of decisaoPorChave) {
        if (decisao.acao === "IGNORAR") continue
        const pessoaId = idPorChave.get(chave)
        const no = noPorChave.get(chave)
        if (pessoaId == null || !no) continue

        const autorizados = new Set(decisao.camposAAplicar ?? [])
        if (autorizados.size === 0) continue

        const ehNova = reversao.pessoas.includes(pessoaId)
        const atual = ehNova
          ? null
          : await tx.pessoa.findUnique({
              where: { id: pessoaId },
              select: {
                sexo: true,
                data_nasc: true,
                data_obito: true,
                local_nasc: true,
                pais_nasc: true,
                profissao: true,
              },
            })

        const dados: Record<string, unknown> = {}
        const anteriores: Record<string, string | null> = {}
        for (const dado of no.dados) {
          if (dado.bloqueado || !autorizados.has(dado.campo)) continue
          const coluna = CAMPO_PARA_COLUNA[dado.campo]
          if (!coluna) continue
          const valor = paraColuna(coluna, dado.valor)
          if (valor === undefined) continue
          anteriores[coluna] = atual ? valorAtual(atual as unknown as Record<string, unknown>, coluna) : null
          dados[coluna] = valor
        }
        if (Object.keys(dados).length === 0) continue

        await tx.pessoa.update({ where: { id: pessoaId }, data: dados })
        pessoasAtualizadas.add(pessoaId)
        if (!ehNova) reversao.camposAnteriores.push({ pessoaId, valores: anteriores })
      }

      // ---- 3. vínculos
      const unioesCriadas: number[] = []
      for (const decisao of p.decisoesVinculos) {
        if (!decisao.aplicar) continue
        const de = idPorChave.get(decisao.deChave)
        const para = idPorChave.get(decisao.paraChave)
        if (de == null || para == null || de === para) continue

        if (decisao.tipo === "UNIAO") {
          const ja = await tx.uniao.findFirst({
            where: {
              OR: [
                { pessoa1Id: de, pessoa2Id: para },
                { pessoa1Id: para, pessoa2Id: de },
              ],
            },
            select: { id: true },
          })
          if (ja) continue
          const criada = await tx.uniao.create({
            data: { pessoa1Id: de, pessoa2Id: para, tipo: "casamento" },
            select: { id: true },
          })
          unioesCriadas.push(criada.id)
          reversao.unioes.push(criada.id)
          vinculosCriados++
          continue
        }

        const coluna = decisao.tipo === "FILIACAO_PAI" ? "paiId" : "maeId"
        const antes = await tx.pessoa.findUnique({ where: { id: de }, select: { paiId: true, maeId: true } })
        if (!antes) continue
        if ((coluna === "paiId" ? antes.paiId : antes.maeId) === para) continue

        if (!reversao.vinculosAnteriores.some((v) => v.pessoaId === de)) {
          reversao.vinculosAnteriores.push({ pessoaId: de, paiId: antes.paiId, maeId: antes.maeId })
        }
        await tx.pessoa.update({ where: { id: de }, data: { [coluna]: para } })
        pessoasAtualizadas.add(de)
        vinculosCriados++
      }

      // ---- 4. documentos, na Pasta Documental existente
      for (const decisao of p.decisoesDocumentos) {
        if (decisao.descartar) continue
        const analise = p.analise.find((a) => a.indice === decisao.indice)
        const arquivo = p.arquivos[decisao.indice]
        if (!analise || !arquivo) {
          erros.push({ referencia: `arquivo #${decisao.indice + 1}`, motivo: "Arquivo não encontrado na análise." })
          continue
        }
        const chave = decisao.pessoaChave ?? analise.sujeitoChave
        const pessoaId = chave ? idPorChave.get(chave) : undefined
        if (pessoaId == null) {
          erros.push({
            referencia: analise.nome,
            motivo: "Sem pessoa definida para este documento — ele não foi gravado.",
          })
          continue
        }

        const tipo = tipoPorNatureza.get(analise.tipo) ?? null
        const doc = await tx.documento.create({
          data: {
            pessoaId,
            documentTypeId: tipo?.id ?? null,
            tipo: tipo?.legacyEnumKey as Prisma.DocumentoCreateInput["tipo"],
            status: "RECEBIDO",
            descricao: arquivo.nome.slice(0, 200),
            arquivo_url: arquivo.url,
            arquivo_nome: arquivo.nome.slice(0, 200),
            arquivo_tamanho: arquivo.tamanho ?? null,
            arquivo_mime_type: arquivo.mimeType?.slice(0, 100) ?? null,
            origem: "manual",
            necessidadeId: analise.necessidade?.id ?? null,
            // A transcrição saiu da análise — não se paga leitura duas vezes.
            transcricaoTexto: analise.transcricao?.paginas.map((x) => x.texto).join("\n\n") ?? null,
            transcricaoPaginas: (analise.transcricao?.paginas ?? undefined) as unknown as Prisma.InputJsonValue,
            transcricaoFonte: analise.transcricao?.fonte ?? null,
            transcricaoEm: analise.transcricao ? new Date() : null,
          },
          select: { id: true },
        })
        reversao.documentos.push(doc.id)
      }

      // ---- 5. registro de reversão, DENTRO da transação.
      //
      // Se este registro ficasse de fora e falhasse, a árvore teria sido alterada
      // sem nenhum caminho de volta — exatamente o cenário que o rollback existe
      // para impedir. Aqui, ou a importação e o seu bilhete de volta existem
      // juntos, ou nenhum dos dois existe.
      const registro = await tx.logAuditoria.create({
        data: {
          acao: "registral_importacao_confirmada",
          entidade: "Processo",
          entidadeId: p.processoId,
          descricao:
            `Importação aplicada: ${reversao.pessoas.length} pessoa(s) criada(s), ${vinculosCriados} vínculo(s), ` +
            `${reversao.documentos.length} documento(s) na Pasta Documental.`,
          detalhes: {
            reversao: reversao as unknown as Prisma.InputJsonValue,
            revertida: false,
            pessoasAtualizadas: [...pessoasAtualizadas],
          } as unknown as Prisma.InputJsonValue,
          usuarioId: p.usuarioId ?? null,
        },
        select: { id: true },
      })

      return {
        reversao,
        erros,
        pessoasAtualizadas: [...pessoasAtualizadas],
        vinculosCriados,
        unioesCriadas,
        importacaoId: registro.id,
      }
    },
    { timeout: 120_000 },
  )

  const out: ResultadoConfirmacao = {
    processoId: p.processoId,
    importacaoId: aplicado.importacaoId,
    documentosCriados: aplicado.reversao.documentos,
    pessoasCriadas: aplicado.reversao.pessoas,
    pessoasAtualizadas: aplicado.pessoasAtualizadas,
    vinculosCriados: aplicado.vinculosCriados,
    unioesCriadas: aplicado.unioesCriadas,
    descartados: p.decisoesDocumentos.filter((d) => d.descartar).length,
    loteId: null,
    propostas: 0,
    conflitos: 0,
    erros: aplicado.erros,
  }

  // ---- motor registral sobre o que entrou
  if (out.documentosCriados.length) {
    const lote = await criarLote({
      processoId: p.processoId,
      documentoIds: out.documentosCriados,
      usuarioId: p.usuarioId ?? null,
    })
    out.loteId = lote.loteId
    const r = await processarLote({ loteId: lote.loteId, usuarioId: p.usuarioId ?? null })
    out.propostas = r.propostasCriadas
    out.conflitos = r.conflitosAbertos

    // O lote nasce depois da transação; o bilhete de volta passa a conhecê-lo.
    // Falhar aqui não deixa a importação irreversível: apagar os documentos já
    // leva embora execuções e evidências por cascata.
    await prisma.logAuditoria
      .update({
        where: { id: out.importacaoId },
        data: {
          detalhes: {
            reversao: { ...aplicado.reversao, loteId: lote.loteId } as unknown as Prisma.InputJsonValue,
            revertida: false,
            pessoasAtualizadas: aplicado.pessoasAtualizadas,
          } as unknown as Prisma.InputJsonValue,
        },
      })
      .catch((e) => logRegistral("warn", "importacao_lote_nao_registrado", { importacaoId: out.importacaoId, erro: String(e) }))
  }

  logRegistral("info", "importacao_confirmada", {
    processoId: p.processoId,
    importacaoId: out.importacaoId,
    pessoas: out.pessoasCriadas.length,
    vinculos: out.vinculosCriados,
    documentos: out.documentosCriados.length,
    erros: out.erros.length,
  })

  return out
}

function paraColuna(coluna: string, valor: string): unknown {
  if (coluna === "data_nasc" || coluna === "data_obito") {
    const d = new Date(`${valor}T12:00:00Z`)
    return Number.isNaN(d.getTime()) ? undefined : d
  }
  if (coluna === "sexo") return valor === "M" || valor === "F" ? valor : undefined
  return valor.slice(0, 100)
}

async function mapaDeTiposDocumentais(): Promise<
  Map<NaturezaRegistral, { id: number; legacyEnumKey: string | null }>
> {
  const tipos = await prisma.tipoDocumentoCadastro.findMany({
    where: { ativo: true, legacyEnumKey: { not: null } },
    select: { id: true, legacyEnumKey: true },
  })
  const acha = (chave: string) => tipos.find((t) => (t.legacyEnumKey ?? "").toUpperCase() === chave)
  const mapa = new Map<NaturezaRegistral, { id: number; legacyEnumKey: string | null }>()
  const par: Array<[NaturezaRegistral, string]> = [
    ["NASCIMENTO", "CERTIDAO_NASCIMENTO"],
    ["CASAMENTO", "CERTIDAO_CASAMENTO"],
    ["OBITO", "CERTIDAO_OBITO"],
    ["BATISMO", "CERTIDAO_BATISMO"],
    ["NATURALIZACAO", "CNN"],
  ]
  for (const [natureza, chave] of par) {
    const t = acha(chave)
    if (t) mapa.set(natureza, t)
  }
  return mapa
}

// ============================================================================
// FASE 3 — REVERTER (desfaz a importação inteira)
// ============================================================================

export interface ResultadoReversao {
  importacaoId: number
  documentosRemovidos: number
  pessoasRemovidas: number
  unioesRemovidas: number
  camposRestaurados: number
  vinculosRestaurados: number
  naoRemovidos: Array<{ tipo: string; id: number; motivo: string }>
}

/**
 * Desfaz uma importação a partir do registro de auditoria.
 *
 * Conservador por construção: uma pessoa criada pela importação que DEPOIS ganhou
 * filho, documento ou união que não vieram desta importação NÃO é removida —
 * removê-la apagaria trabalho de outra pessoa. Ela fica, e o relatório diz por
 * quê. Reverter nunca destrói mais do que a importação criou.
 */
export async function reverterImportacao(p: {
  importacaoId: number
  usuarioId?: number | null
}): Promise<ResultadoReversao> {
  const log = await prisma.logAuditoria.findUnique({
    where: { id: p.importacaoId },
    select: { id: true, acao: true, detalhes: true, entidadeId: true },
  })
  if (!log || log.acao !== "registral_importacao_confirmada") {
    throw new Error("Importação não encontrada (o identificador não corresponde a uma importação aplicada).")
  }
  const detalhes = (log.detalhes ?? {}) as { reversao?: RegistroReversao; revertida?: boolean }
  if (detalhes.revertida) throw new Error("Esta importação já foi revertida.")
  const reg = detalhes.reversao
  if (!reg) throw new Error("Esta importação não tem registro de reversão.")

  const out: ResultadoReversao = {
    importacaoId: log.id,
    documentosRemovidos: 0,
    pessoasRemovidas: 0,
    unioesRemovidas: 0,
    camposRestaurados: 0,
    vinculosRestaurados: 0,
    naoRemovidos: [],
  }

  await prisma.$transaction(
    async (tx) => {
      // ---- 1. o que o motor produziu a partir destes documentos
      //
      // Ordem obrigatória: o que APONTA vem antes do que é apontado. Proposta e
      // conflito referenciam o lote; evidência e execução referenciam o documento
      // (e caem por cascata quando ele cai, mas apagar explicitamente deixa o
      // rastro do rollback legível na auditoria do banco).
      const docs = reg.documentos ?? []
      const loteId = reg.loteId ?? null
      if (loteId != null) {
        await tx.decisaoRevisaoRegistral.deleteMany({ where: { proposta: { loteId } } })
        await tx.impactoAplicacaoRegistral.deleteMany({ where: { proposta: { loteId } } })
        await tx.propostaReconciliacao.deleteMany({ where: { loteId } })
        await tx.conflitoRegistral.deleteMany({ where: { loteId } })
      }
      if (docs.length) {
        await tx.evidenciaRegistral.deleteMany({ where: { documentoId: { in: docs } } })
        await tx.correspondenciaIdentidade.deleteMany({
          where: { ocorrencia: { execucao: { documentoId: { in: docs } } } },
        })
        await tx.ocorrenciaDocumental.deleteMany({ where: { execucao: { documentoId: { in: docs } } } })
        await tx.etapaExecucaoRegistral.deleteMany({ where: { execucao: { documentoId: { in: docs } } } })
        await tx.execucaoRegistral.deleteMany({ where: { documentoId: { in: docs } } })
        const r = await tx.documento.deleteMany({ where: { id: { in: docs } } })
        out.documentosRemovidos = r.count
      }
      if (loteId != null) await tx.loteRegistral.deleteMany({ where: { id: loteId } })

      // ---- 2. uniões criadas
      if (reg.unioes?.length) {
        const r = await tx.uniao.deleteMany({ where: { id: { in: reg.unioes } } })
        out.unioesRemovidas = r.count
      }

      // ---- 3. filiações alteradas voltam ao que eram
      for (const v of reg.vinculosAnteriores ?? []) {
        await tx.pessoa.update({ where: { id: v.pessoaId }, data: { paiId: v.paiId, maeId: v.maeId } })
        out.vinculosRestaurados++
      }

      // ---- 4. campos alterados voltam ao que eram
      for (const c of reg.camposAnteriores ?? []) {
        const dados: Record<string, unknown> = {}
        for (const [coluna, antes] of Object.entries(c.valores)) {
          dados[coluna] = antes == null ? null : (paraColuna(coluna, antes) ?? null)
        }
        if (Object.keys(dados).length === 0) continue
        await tx.pessoa.update({ where: { id: c.pessoaId }, data: dados })
        out.camposRestaurados++
      }

      // ---- 5. pessoas criadas — só as que continuam sendo só desta importação
      for (const pessoaId of reg.pessoas ?? []) {
        const dependentes = await tx.pessoa.findUnique({
          where: { id: pessoaId },
          select: {
            _count: {
              select: {
                documentos: true,
                filhosComoPai: true,
                filhosComoMae: true,
                unioesComoPessoa1: true,
                unioesComoPessoa2: true,
              },
            },
          },
        })
        if (!dependentes) continue
        const c = dependentes._count
        const total = c.documentos + c.filhosComoPai + c.filhosComoMae + c.unioesComoPessoa1 + c.unioesComoPessoa2
        if (total > 0) {
          out.naoRemovidos.push({
            tipo: "Pessoa",
            id: pessoaId,
            motivo: "Ganhou documentos ou vínculos depois da importação — remover apagaria trabalho posterior.",
          })
          continue
        }
        await tx.pessoa.updateMany({ where: { paiId: pessoaId }, data: { paiId: null } })
        await tx.pessoa.updateMany({ where: { maeId: pessoaId }, data: { maeId: null } })
        await tx.pessoa.delete({ where: { id: pessoaId } })
        out.pessoasRemovidas++
      }

      await tx.logAuditoria.update({
        where: { id: log.id },
        data: {
          detalhes: {
            ...(detalhes as Record<string, unknown>),
            revertida: true,
            revertidaPor: p.usuarioId ?? null,
          } as unknown as Prisma.InputJsonValue,
        },
      })
    },
    { timeout: 120_000 },
  )

  await auditar(prisma, {
    acao: "registral_importacao_revertida",
    entidade: "Processo",
    entidadeId: log.entidadeId ?? reg.processoId,
    descricao:
      `Importação #${log.id} revertida: ${out.documentosRemovidos} documento(s), ${out.pessoasRemovidas} pessoa(s), ` +
      `${out.unioesRemovidas} união(ões), ${out.camposRestaurados} campo(s) restaurado(s).`,
    detalhes: out as unknown as Prisma.InputJsonValue,
    usuarioId: p.usuarioId ?? null,
  })

  return out
}
