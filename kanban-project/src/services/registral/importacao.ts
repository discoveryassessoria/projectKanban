// src/services/registral/importacao.ts
//
// IMPORTAÇÃO DE CERTIDÕES pela Árvore — as duas fases.
//
// Por que DUAS fases, e não uma:
//
//   `Documento.pessoaId` é obrigatório. Criar o registro no momento do upload
//   obrigaria a pendurar a certidão numa pessoa provisória — documento no dossiê
//   errado, ainda que por um instante, num sistema que existe para ser auditável.
//   Então primeiro se LÊ (sem gravar nada), o operador confere de quem é cada
//   documento, e só então se GRAVA, já no lugar certo.
//
//   ANALISAR  → baixa, transcreve, classifica, extrai (dupla), confere, resolve
//               identidade contra a árvore e monta a PRÉVIA. Zero escrita.
//   CONFIRMAR → cria o Documento na Pasta Documental existente (com a pessoa que
//               o operador aprovou e a transcrição já pronta), liga à necessidade
//               quando ela existe, e roda o motor registral.
//
// A árvore não ganha armazenamento paralelo: o arquivo vive no mesmo storage e o
// registro vive em `Documento`, exatamente como qualquer outro documento do
// processo. A aba Documentos continua sendo o repositório — esta importação só
// deixa de obrigar o operador a sair da Árvore para alimentá-la.

import { prisma } from "@/lib/prisma"
import { Prisma } from "@prisma/client"
import { classificarDocumento } from "@/src/lib/genealogia/registral/classificador"
import { conferir } from "@/src/lib/genealogia/registral/conferencia"
import { extrairAncorado } from "@/src/lib/genealogia/registral/extracao-ancorada"
import { extrairEstrutural } from "@/src/lib/genealogia/registral/extracao-estrutural"
import { resolverIdentidade } from "@/src/lib/genealogia/registral/identidade"
import { ROTULO_CAMPO } from "@/src/lib/genealogia/registral/campos"
import type {
  CampoConferido,
  LeituraDocumento,
  NaturezaRegistral,
  OcorrenciaExtraida,
  PapelOcorrencia,
  PessoaConhecida,
} from "@/src/lib/genealogia/registral/tipos"
import { auditar, logRegistral } from "./auditoria"
import { baixarArquivo, transcreverArquivo } from "./ocr"
import { criarLote, processarLote } from "./lote"
import { carregarContexto } from "./estado"

// ============================================================================
// FASE 1 — ANALISAR (nenhuma escrita)
// ============================================================================

export interface ArquivoImportado {
  /** URL pública no storage do projeto (o upload já aconteceu). */
  url: string
  nome: string
  mimeType: string | null
  tamanho?: number | null
}

export interface PessoaSugerida {
  pessoaId: number | null
  nome: string
  /** CORRESPONDENCIA_CONFIRMADA | ALTAMENTE_PROVAVEL | POSSIVEL | ... */
  classe: string | null
  score: number | null
  /** true quando não existe no cadastro e seria criada. */
  nova: boolean
  motivo: string
}

export interface CampoAnalisado {
  campo: string
  rotulo: string
  papel: PapelOcorrencia
  valor: string | null
  veredicto: string
  confianca: number
  divergente: boolean
  explicacao: string
}

export interface DivergenciaAnalisada {
  campo: string
  rotulo: string
  leituraA: string | null
  leituraB: string | null
  critica: boolean
  explicacao: string
}

export interface ArquivoAnalisado {
  /** Índice estável no lote enviado — é o que o cliente usa para casar a resposta. */
  indice: number
  nome: string
  url: string
  mimeType: string | null
  /** Natureza registral detectada. */
  tipo: NaturezaRegistral
  confiancaTipo: number
  fonteTexto: string | null
  provedorTranscricao: string | null
  legivel: boolean
  motivoIlegivel: string | null
  /** Sujeito do documento (o registrado) e a quem ele seria vinculado. */
  sujeito: PessoaSugerida | null
  /** Demais menções: pai, mãe, cônjuge… */
  participantes: Array<{ papel: PapelOcorrencia; nome: string; sugestao: PessoaSugerida }>
  campos: CampoAnalisado[]
  divergencias: DivergenciaAnalisada[]
  /** Necessidade documental que este documento atenderia, se houver. */
  necessidade: { id: number; item: string } | null
  /** Transcrição obtida — devolvida para não refazer OCR na confirmação. */
  transcricao: { paginas: Array<{ pagina: number; texto: string }>; fonte: string } | null
}

export interface NoPrevia {
  chave: string
  nome: string
  papel: PapelOcorrencia
  pessoaId: number | null
  nova: boolean
  /** Chaves dos pais dentro da prévia (para desenhar a árvore proposta). */
  paiChave: string | null
  maeChave: string | null
  documentos: number[]
}

export interface ResultadoAnalise {
  processoId: number
  arvoreId: number | null
  arquivos: ArquivoAnalisado[]
  /** Árvore PROPOSTA: pessoas e vínculos que sairiam desta importação. */
  previa: NoPrevia[]
  resumo: {
    total: number
    legiveis: number
    ilegiveis: number
    pessoasNovas: number
    pessoasVinculadas: number
    divergencias: number
    semOcr: boolean
  }
  /** Situação dos provedores — explica documento escaneado sem leitura. */
  avisos: string[]
}

/** Chave estável de uma pessoa dentro da prévia (id real, ou nome normalizado). */
function chaveDaPessoa(pessoaId: number | null, nome: string): string {
  return pessoaId != null ? `p${pessoaId}` : `n:${nome}`
}

export async function analisarImportacao(p: {
  processoId: number
  arquivos: ArquivoImportado[]
  usuarioId?: number | null
}): Promise<ResultadoAnalise> {
  const ctx = await carregarContexto(prisma, p.processoId)
  const arvoreId = ctx?.arvoreId ?? null

  const candidatos = arvoreId != null ? await carregarPessoasDaArvore(arvoreId) : []
  const necessidades =
    arvoreId != null
      ? await prisma.necessidadeDocumental.findMany({
          where: { processoId: p.processoId, status: { in: ["PENDENTE", "EM_ATENDIMENTO"] } },
          select: { id: true, pessoaId: true, itemCatalogo: { select: { code: true, name: true } } },
        })
      : []

  const analisados: ArquivoAnalisado[] = []
  const avisos = new Set<string>()

  for (let i = 0; i < p.arquivos.length; i++) {
    const arquivo = p.arquivos[i]
    const base: ArquivoAnalisado = {
      indice: i,
      nome: arquivo.nome,
      url: arquivo.url,
      mimeType: arquivo.mimeType,
      tipo: "DESCONHECIDO",
      confiancaTipo: 0,
      fonteTexto: null,
      provedorTranscricao: null,
      legivel: false,
      motivoIlegivel: null,
      sujeito: null,
      participantes: [],
      campos: [],
      divergencias: [],
      necessidade: null,
      transcricao: null,
    }

    // ---- baixar + transcrever (sem gravar)
    const download = await baixarArquivo(arquivo.url)
    if (!download.ok) {
      analisados.push({ ...base, motivoIlegivel: download.motivo })
      continue
    }
    const { resultado, tentativas } = await transcreverArquivo({
      nome: arquivo.nome,
      mimeType: arquivo.mimeType,
      conteudo: download.conteudo,
      referencia: i,
    })
    for (const t of tentativas) {
      if (!t.ok && t.motivo) avisos.add(t.motivo)
    }
    if (!resultado) {
      analisados.push({
        ...base,
        motivoIlegivel:
          tentativas.map((t) => `${t.provedor}: ${t.motivo ?? "sem texto"}`).join(" · ") ||
          "Nenhum provedor sabe ler este tipo de arquivo.",
      })
      continue
    }

    // ---- ler com o motor (funções puras; nenhuma escrita)
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
    const natureza = classificacao.natureza
    const conferencia = conferir(
      extrairAncorado(leitura, natureza),
      extrairEstrutural(leitura, natureza),
      natureza,
    )

    // ---- identidade de cada ocorrência
    const resolvidas = new Map<PapelOcorrencia, PessoaSugerida>()
    for (const oc of conferencia.ocorrencias) {
      resolvidas.set(oc.papel, sugerir(oc, candidatos, arvoreId))
    }

    const sujeito = resolvidas.get("REGISTRADO") ?? null
    const participantes = [...resolvidas.entries()]
      .filter(([papel]) => papel !== "REGISTRADO")
      .map(([papel, sugestao]) => ({
        papel,
        nome: conferencia.ocorrencias.find((o) => o.papel === papel)?.nomeNormalizado ?? sugestao.nome,
        sugestao,
      }))

    analisados.push({
      ...base,
      tipo: natureza,
      confiancaTipo: classificacao.confianca,
      fonteTexto: resultado.provedor,
      provedorTranscricao: resultado.provedor,
      legivel: !conferencia.insuficiente,
      motivoIlegivel: conferencia.motivoInsuficiencia,
      sujeito,
      participantes,
      campos: conferencia.campos.filter((c) => c.valorNormalizado || c.veredicto === "DIVERGENTE").map(paraCampo),
      divergencias: conferencia.campos.filter((c) => c.veredicto === "DIVERGENTE").map(paraDivergencia),
      necessidade: casarNecessidade(natureza, sujeito?.pessoaId ?? null, necessidades),
      transcricao: { paginas: resultado.paginas, fonte: resultado.provedor },
    })
  }

  const previa = montarPrevia(analisados)

  await auditar(prisma, {
    acao: "registral_importacao_analisada",
    entidade: "Processo",
    entidadeId: p.processoId,
    descricao: `Importação analisada: ${analisados.length} arquivo(s), ${analisados.filter((a) => a.legivel).length} legível(is).`,
    detalhes: {
      arquivos: analisados.length,
      legiveis: analisados.filter((a) => a.legivel).length,
      divergencias: analisados.reduce((s, a) => s + a.divergencias.length, 0),
    },
    usuarioId: p.usuarioId ?? null,
  })

  return {
    processoId: p.processoId,
    arvoreId,
    arquivos: analisados,
    previa,
    resumo: {
      total: analisados.length,
      legiveis: analisados.filter((a) => a.legivel).length,
      ilegiveis: analisados.filter((a) => !a.legivel).length,
      pessoasNovas: previa.filter((n) => n.nova).length,
      pessoasVinculadas: previa.filter((n) => !n.nova).length,
      divergencias: analisados.reduce((s, a) => s + a.divergencias.length, 0),
      semOcr: analisados.some((a) => !a.legivel && !a.transcricao),
    },
    avisos: [...avisos],
  }
}

function paraCampo(c: CampoConferido): CampoAnalisado {
  return {
    campo: c.campo,
    rotulo: ROTULO_CAMPO[c.campo] ?? c.campo,
    papel: c.papel,
    valor: c.valorNormalizado,
    veredicto: c.veredicto,
    confianca: c.confianca,
    divergente: c.veredicto === "DIVERGENTE",
    explicacao: c.explicacao,
  }
}

function paraDivergencia(c: CampoConferido): DivergenciaAnalisada {
  return {
    campo: c.campo,
    rotulo: ROTULO_CAMPO[c.campo] ?? c.campo,
    leituraA: c.a?.valorNormalizado ?? null,
    leituraB: c.b?.valorNormalizado ?? null,
    critica: c.bloqueadoParaRevisao,
    explicacao: c.explicacao,
  }
}

function sugerir(
  oc: OcorrenciaExtraida,
  candidatos: PessoaConhecida[],
  arvoreId: number | null,
): PessoaSugerida {
  const r = resolverIdentidade(oc, candidatos, { arvorePreferidaId: arvoreId })
  const melhor = r.correspondencias[0] ?? null
  const forte =
    melhor && (melhor.classe === "CORRESPONDENCIA_CONFIRMADA" || melhor.classe === "ALTAMENTE_PROVAVEL")

  if (forte) {
    const p = candidatos.find((c) => c.id === melhor.pessoaId)
    return {
      pessoaId: melhor.pessoaId,
      nome: p ? [p.nome, p.sobrenome].filter(Boolean).join(" ") : oc.nomeNormalizado,
      classe: melhor.classe,
      score: melhor.score,
      nova: false,
      motivo: r.explicacao,
    }
  }
  return {
    pessoaId: null,
    nome: oc.nomeNormalizado,
    classe: melhor?.classe ?? null,
    score: melhor?.score ?? null,
    nova: true,
    motivo: r.explicacao,
  }
}

/** Monta a árvore PROPOSTA a partir do que foi lido — só o que os documentos dizem. */
function montarPrevia(arquivos: ArquivoAnalisado[]): NoPrevia[] {
  const nos = new Map<string, NoPrevia>()

  const garantir = (s: PessoaSugerida, papel: PapelOcorrencia, documentoIndice: number): NoPrevia => {
    const chave = chaveDaPessoa(s.pessoaId, s.nome)
    const existente = nos.get(chave)
    if (existente) {
      if (!existente.documentos.includes(documentoIndice)) existente.documentos.push(documentoIndice)
      return existente
    }
    const novo: NoPrevia = {
      chave,
      nome: s.nome,
      papel,
      pessoaId: s.pessoaId,
      nova: s.nova,
      paiChave: null,
      maeChave: null,
      documentos: [documentoIndice],
    }
    nos.set(chave, novo)
    return novo
  }

  for (const a of arquivos) {
    if (!a.legivel || !a.sujeito) continue
    const registrado = garantir(a.sujeito, "REGISTRADO", a.indice)

    for (const part of a.participantes) {
      const no = garantir(part.sugestao, part.papel, a.indice)
      if (part.papel === "PAI") registrado.paiChave = no.chave
      if (part.papel === "MAE") registrado.maeChave = no.chave
    }
  }

  // Ordem estável: quem tem filiação apontando para ele primeiro (topo da árvore).
  return [...nos.values()].sort((a, b) => {
    if (a.nova !== b.nova) return a.nova ? 1 : -1
    return a.nome.localeCompare(b.nome)
  })
}

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

/** Necessidade em aberto que este documento atenderia (mesmo sujeito, mesma natureza). */
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
// FASE 2 — CONFIRMAR (grava na Pasta Documental e roda o motor)
// ============================================================================

export interface DecisaoImportacao {
  indice: number
  /** Pessoa aprovada pelo operador. `null` = criar nova com o nome lido. */
  pessoaId: number | null
  /** Nome a usar quando for criar pessoa nova. */
  nomeNovaPessoa?: string | null
  /** Operador pode descartar um arquivo na revisão. */
  descartar?: boolean
}

export interface ResultadoConfirmacao {
  processoId: number
  documentosCriados: number[]
  pessoasCriadas: number[]
  descartados: number
  loteId: number | null
  propostas: number
  conflitos: number
  erros: Array<{ indice: number; motivo: string }>
}

export async function confirmarImportacao(p: {
  processoId: number
  arquivos: ArquivoImportado[]
  analise: ArquivoAnalisado[]
  decisoes: DecisaoImportacao[]
  usuarioId?: number | null
}): Promise<ResultadoConfirmacao> {
  const ctx = await carregarContexto(prisma, p.processoId)
  const arvoreId = ctx?.arvoreId ?? null
  if (arvoreId == null) throw new Error("O processo não tem árvore vinculada.")

  const out: ResultadoConfirmacao = {
    processoId: p.processoId,
    documentosCriados: [],
    pessoasCriadas: [],
    descartados: 0,
    loteId: null,
    propostas: 0,
    conflitos: 0,
    erros: [],
  }

  const porIndice = new Map(p.analise.map((a) => [a.indice, a]))
  const tipoPorNatureza = await mapaDeTiposDocumentais()

  for (const decisao of p.decisoes) {
    if (decisao.descartar) {
      out.descartados++
      continue
    }
    const analise = porIndice.get(decisao.indice)
    const arquivo = p.arquivos[decisao.indice]
    if (!analise || !arquivo) {
      out.erros.push({ indice: decisao.indice, motivo: "Arquivo não encontrado na análise." })
      continue
    }

    try {
      // Uma transação por documento: o documento e a pessoa que ele exige nascem
      // juntos ou não nascem. Falha num arquivo não derruba os outros.
      const criado = await prisma.$transaction(async (tx) => {
        let pessoaId = decisao.pessoaId

        if (pessoaId == null) {
          const nome = (decisao.nomeNovaPessoa ?? analise.sujeito?.nome ?? "").trim()
          if (!nome) throw new Error("Sem pessoa escolhida e sem nome para criar.")
          const partes = nome.split(/\s+/)
          const nova = await tx.pessoa.create({
            data: {
              nome: partes[0].slice(0, 50),
              sobrenome: partes.slice(1).join(" ").slice(0, 40) || null,
              arvoreId,
              linhaReta: false,
            },
            select: { id: true },
          })
          pessoaId = nova.id
          out.pessoasCriadas.push(nova.id)
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
            // A transcrição já foi obtida na análise — regravar aqui evita pagar
            // OCR duas vezes pelo mesmo arquivo.
            transcricaoTexto: analise.transcricao?.paginas.map((x) => x.texto).join("\n\n") ?? null,
            transcricaoPaginas: (analise.transcricao?.paginas ?? undefined) as unknown as Prisma.InputJsonValue,
            transcricaoFonte: analise.transcricao?.fonte ?? null,
            transcricaoEm: analise.transcricao ? new Date() : null,
          },
          select: { id: true },
        })
        return doc.id
      })

      out.documentosCriados.push(criado)
    } catch (e) {
      out.erros.push({ indice: decisao.indice, motivo: e instanceof Error ? e.message : String(e) })
    }
  }

  // ---- roda o motor sobre o que entrou (fatos, evidências, propostas, conflitos)
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
  }

  await auditar(prisma, {
    acao: "registral_importacao_confirmada",
    entidade: "Processo",
    entidadeId: p.processoId,
    descricao: `Importação confirmada: ${out.documentosCriados.length} documento(s) na Pasta Documental, ${out.pessoasCriadas.length} pessoa(s) criada(s), ${out.descartados} descartado(s).`,
    detalhes: {
      documentos: out.documentosCriados.length,
      pessoas: out.pessoasCriadas.length,
      descartados: out.descartados,
      erros: out.erros.length,
      loteId: out.loteId,
    },
    usuarioId: p.usuarioId ?? null,
  })
  logRegistral("info", "importacao_confirmada", {
    processoId: p.processoId,
    documentos: out.documentosCriados.length,
    erros: out.erros.length,
  })

  return out
}

/** Tipo documental oficial de cada natureza registral (Sistema Documental é o dono). */
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
