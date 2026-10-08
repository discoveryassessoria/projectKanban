// src/services/genealogia/materializar-genealogia.ts
//
// FATIA 2 — Materialização das Regras Documentais na Genealogia (V2).
// Regras Documentais PUBLICADAS exigidas na Genealogia → avaliação por Pessoa →
// NecessidadeDocumental (canônica, idempotente, com snapshot da regra) + Documento
// operacional (rascunho, via `garantirDocumentoDaNecessidade` — mesma porta que o
// clique manual "Iniciar" sempre usou) + passo operacional "Localizar registro"
// (PhaseWorkflowStepInstance) vinculado à necessidade. ADITIVO, IDEMPOTENTE,
// REVERSÍVEL. NÃO avança fase, NÃO conclui, NÃO cria tarefa, NÃO usa
// document-generator/DOCUMENT_RULES/reconcileDocsForPessoa.
//
// Documento nasce JUNTO com a necessidade (unificação 28/09/2026) — não mais só no
// clique manual do editor "Localizar registro". Achado real: a necessidade 607
// (união, processo 651) tinha a Tarefa em EM_ANDAMENTO sem Documento nenhum por
// trás, porque "iniciar a tarefa" e "abrir o editor" eram ações independentes e só
// a segunda criava o Documento. Nasce vazio (rascunho, sem cartório/livro/folha) —
// ver `documentoTemDadosPreenchidos` para distinguir rascunho de dado real.

import { reconciliarTarefas } from "@/lib/operacional/reconciliar-tarefas"
import { reabrirGenealogiaParaNecessidadeTardiaTx, reconciliarGenealogiaEEmissaoTx } from "@/src/services/genealogia/trava-emissao-por-genealogia"
import { prisma } from "@/lib/prisma"
import { pessoasAtivasDaArvore } from "@/src/lib/genealogia/vinculo-ativo"
import type { Prisma } from "@prisma/client"
import { garantirNecessidade, dispensarNecessidade, reativarNecessidade, MOTIVO_DOCUMENTO_DISPENSADO } from "@/src/services/necessidade-documental"
import { transicionarPassoTx } from "@/src/services/task-step-sync"
import { SELECT_UNIAO_PARA_TITULAR, titularDaUniao } from "@/src/services/genealogia/titular-uniao"
import { reapontarDonoDoCasamento } from "@/src/services/genealogia/dono-casamento"
import { randomUUID } from "crypto"
import { garantirDocumentoDaNecessidade } from "@/src/services/genealogia/operacao-necessidade"
import { recalcularNumerosLinhagemDaArvore } from "@/src/services/genealogia/numero-linhagem"
import { matrizParaRegra } from "@/src/lib/documentos/regras-documentais/mapear"
import { avaliarRegrasDocumentais } from "@/src/lib/documentos/regras-documentais/avaliador"
import type { RegraDocumental, ResultadoRegra, SujeitoContexto } from "@/src/lib/documentos/regras-documentais/tipos"
import {
  politicaDaFase, resolverTiposDocumentais, naturezaPermitidaNaFase, recebeWorkflowOperacional,
  type TipoDocumentalResolvido,
} from "@/src/lib/documentos/politica-natureza-fase"
import { idadeEmAnos, maioridadeEfetiva, ehRequerente } from "@/src/lib/documentos/maioridade"
import { aplicarHonorariosCidadaniaItaliana } from "@/src/lib/motor/executor"
import { materializarExecucaoDaFase } from "@/src/services/materializar-fase"
import { reconciliarMotorDeFases } from "@/src/lib/motor/reconciliar-motor-fases"
import { resolverWorkflowAplicavel } from "@/src/services/phase-workflow"
import { ehFaseAguardandoFechamento } from "@/src/lib/process-stage/fase-pre-contrato"
import { codigoExigivelDoTipo, documentoEscolhidoParaPessoa, documentoDaUniaoEscolhido, type PessoaParaFiltroDocumental } from "@/src/lib/genealogia/documentos-exigidos"
import { montarPessoasDoProcesso, type ClassificacaoPessoa, type PessoaBruta, type UniaoBruta } from "@/src/lib/process-stage/central-operacional-core"

type DB = typeof prisma | Prisma.TransactionClient

/**
 * A REGRA — "nunca mais árvore ↔ documentação" (mandato Torre de Controle, 29/09/2026).
 *
 * `Pessoa.documentacao` é o interruptor de quem está FORA da linhagem: por padrão
 * (`@default(true)`) todo mundo entra, e desligar tira. Quem está NA linhagem — o
 * requerente e os ascendentes diretos que a classificação confirma — nunca pode ser
 * excluído por este campo: a exigência documental deles não depende de um checkbox
 * pensado para parentes de apoio. `PENDENTE_CLASSIFICACAO` (declarado na linha reta,
 * mas sem filiação que a travessia confirme) é tratado como "exige" — é pendência de
 * CADASTRO a resolver, nunca um motivo pra dispensar documento sozinho.
 *
 * Achado real (processo 675, 29/09/2026): o filtro antigo excluía QUALQUER pessoa com
 * `documentacao: false` da avaliação, linhagem ou não — o campo nunca deveria ter
 * esse poder sobre quem está na linha reta.
 */
export function pessoaExigeDocumentacao(classificacao: ClassificacaoPessoa, documentacao: boolean): boolean {
  return classificacao === "FORA_DA_LINHAGEM" ? documentacao === true : true
}

export interface ExigenciaGenealogia {
  pessoaId: number | null
  uniaoId: number | null
  chave: string
  varianteKey: string
  itemCatalogoId: number
  regra: RegraDocumental
  ap: ResultadoRegra
  sujeitoNome: string
}

export interface CalculoExigenciasGenealogia {
  processoId: number
  tipoProcessoId: number | null
  arvoreId: number
  exigencias: ExigenciaGenealogia[]
  /**
   * O que a regra automática exigiria mas a ESCOLHA MANUAL (`Pessoa.documentosExigidos`) tirou. Deduplicado por chave.
   * Vazio = ninguém removeu nada por escolha — é o que distingue "zero por escolha" de "zero natural".
   */
  removidasPorEscolha: ExigenciaGenealogia[]
  pendencias: string[]
  instancia: { id: number; ciclo: number } | null
  labelLocalizarRegistro: string
  slaDaysLocalizarRegistro: number
  tipoPorCode: Map<string, TipoDocumentalResolvido>
}

/**
 * NÚCLEO PURO (sem escrita nenhuma): deriva de árvore + matriz + `documentacao` o
 * conjunto de exigências documentais da Genealogia deste processo — a MESMA
 * pergunta que `materializarGenealogia` responde antes de gravar, e que `NEC-001`
 * (Saúde) faz de novo, sozinha, para comparar com o que está gravado. Uma leitura
 * aqui não escreve nada em lugar nenhum — quem decide se aplica é o chamador.
 */
export async function calcularExigenciasDaGenealogia(processoId: number, db: DB = prisma): Promise<CalculoExigenciasGenealogia | null> {
  const processo = await db.processo.findUnique({
    where: { id: processoId },
    select: { id: true, arvoreId: true, tipoProcessoMotorId: true },
  })
  if (!processo?.arvoreId) return null

  const regras = await regrasGenealogiaDoProcesso(processo.tipoProcessoMotorId ?? null, db)
  const pendencias: string[] = []
  if (regras.length === 0) pendencias.push("nenhuma Regra Documental publicada exigida na Genealogia")

  const wfGenealogia = await resolverWorkflowAplicavel(processo.tipoProcessoMotorId ?? null, FASE_GENEALOGIA, db)
  const passoLocalizarRegistroCadastrado =
    "steps" in wfGenealogia ? wfGenealogia.steps.find((s) => s.key === STEP_LOCALIZAR) : null
  const slaDaysLocalizarRegistro = passoLocalizarRegistroCadastrado?.slaDays ?? 5
  const labelLocalizarRegistro = passoLocalizarRegistroCadastrado?.label ?? STEP_LABEL

  // TODAS as pessoas ativas da árvore — SEM filtrar por `documentacao` aqui. O
  // filtro certo depende da CLASSIFICAÇÃO (linhagem), calculada abaixo com os
  // mesmos dados e a mesma régua que a Central Operacional usa
  // (`montarPessoasDoProcesso`) — nunca um `linhaReta` cru e solto neste arquivo.
  const todasAtivas = await db.pessoa.findMany({
    where: pessoasAtivasDaArvore(processo.arvoreId),
    select: {
      id: true, nome: true, sobrenome: true, sexo: true, publicCode: true, numeroLinhagem: true,
      documentacao: true, documentosExigidos: true, casado: true, vivo: true, linhaReta: true, requerente: true, paiId: true, maeId: true, data_nasc: true,
    },
  })
  const todasIds = todasAtivas.map((p) => p.id)
  const todasUnioes: UniaoBruta[] = todasIds.length
    ? await db.uniao.findMany({
        where: { OR: [{ pessoa1Id: { in: todasIds } }, { pessoa2Id: { in: todasIds } }] },
        select: { id: true, pessoa1Id: true, pessoa2Id: true },
      })
    : []
  const classificadas = montarPessoasDoProcesso(todasAtivas as PessoaBruta[], todasUnioes)
  const classificacaoPorId = new Map(classificadas.map((c) => [c.pessoaId, c.classificacao]))
  const pessoas = todasAtivas.filter((p) => pessoaExigeDocumentacao(classificacaoPorId.get(p.id) ?? "PENDENTE_CLASSIFICACAO", p.documentacao))

  const politica = await politicaDaFase(FASE_GENEALOGIA, db)
  if (!politica) pendencias.push(`fase "${FASE_GENEALOGIA}" não existe no Catálogo de Fases`)
  else if (politica.naturezasPermitidas.size === 0) {
    pendencias.push(`fase "${FASE_GENEALOGIA}" sem naturezas documentais habilitadas — cadastre a política da fase`)
  }
  const tiposPorId = await resolverTiposDocumentais(db)
  const tipoPorCode = new Map<string, TipoDocumentalResolvido>()
  for (const t of tiposPorId.values()) if (t.code) tipoPorCode.set(t.code, t)

  const pessoaIds = pessoas.map((p) => p.id)
  // UNIÃO VIVA = os DOIS cônjuges são nós ATIVOS desta árvore. Cônjuge removido da
  // árvore (modo "desativar", que preserva a linha por causa de fato histórico)
  // desfaz o casal para fins de exigência: a união com um lado fora da árvore não
  // sustenta certidão de casamento (achado real: processo 675, Luana removida).
  const ativosSet = new Set(todasIds)
  const uniõesRaw = pessoaIds.length
    ? (await db.uniao.findMany({
        where: { OR: [{ pessoa1Id: { in: pessoaIds } }, { pessoa2Id: { in: pessoaIds } }] },
        select: { id: true, pessoa1Id: true, pessoa2Id: true },
      })).filter((u) => ativosSet.has(u.pessoa1Id) && ativosSet.has(u.pessoa2Id))
    : []
  const uniõesPorPessoa = new Map<number, number[]>()
  const conjugesPorUniao = new Map<number, [number, number]>()
  for (const u of uniõesRaw) {
    conjugesPorUniao.set(u.id, [u.pessoa1Id, u.pessoa2Id])
    for (const pid of [u.pessoa1Id, u.pessoa2Id]) {
      const lista = uniõesPorPessoa.get(pid) ?? []
      lista.push(u.id)
      uniõesPorPessoa.set(pid, lista)
    }
  }

  const instanciaRaw = await db.phaseWorkflowInstance.findFirst({
    where: { processoId, faseMacroKey: FASE_GENEALOGIA, status: { in: ["ATIVO", "BLOQUEADO", "AGUARDANDO"] } },
    orderBy: { ciclo: "desc" },
    select: { id: true, ciclo: true },
  })

  // FILTRO SUBTRATIVO (`Pessoa.documentosExigidos`): classificação + documentação + lista gravada de cada pessoa ativa.
  const paraFiltro = (id: number): PessoaParaFiltroDocumental => {
    const x = todasAtivas.find((a) => a.id === id)
    return {
      classificacao: classificacaoPorId.get(id) ?? "PENDENTE_CLASSIFICACAO",
      documentacao: x?.documentacao === true,
      documentosExigidos: x?.documentosExigidos ?? null,
    }
  }
  const removidasPorEscolha = new Map<string, ExigenciaGenealogia>()

  const exigencias: ExigenciaGenealogia[] = []
  for (const p of pessoas) {
    const sujeito = contextoDaPessoa(p)
    const av = avaliarRegrasDocumentais({
      tipoProcessoId: processo.tipoProcessoMotorId ?? 0,
      faseKey: FASE_GENEALOGIA, sujeito, dataReferencia: new Date().toISOString(), regras,
    })
    for (const ap of av.aplicaveis) {
      const tipoDoc = tipoPorCode.get(ap.documentTypeCode)
      const elegivel = naturezaPermitidaNaFase(politica, tipoDoc)
      if (!elegivel.permitido) { pendencias.push(`"${ap.documentTypeCode}": ${elegivel.detalhe}`); continue }
      const regra = regras.find((r) => r.id === ap.regraId)!
      const codigo = regra.codigo ?? `MDX_${regra.id}`
      const varianteKey = `rd:${codigo}:v${regra.versao}`
      const itemCatalogoId = tipoDoc?.itemCatalogoId ?? null
      if (itemCatalogoId == null) {
        pendencias.push(`sem ItemCatalogo para "${ap.documentTypeCode}" (pessoa ${p.id}, regra ${codigo}) — necessidade não materializada`)
        continue
      }
      type Alvo = { pessoaId?: number; uniaoId?: number; chave: string }
      const alvos: Alvo[] =
        regra.alvoNecessidade === "UNIAO"
          ? (uniõesPorPessoa.get(p.id) ?? []).map((uniaoId) => ({ uniaoId, chave: `u${uniaoId}::${varianteKey}` }))
          : [{ pessoaId: p.id, chave: `p${p.id}::${varianteKey}` }]
      if (regra.alvoNecessidade === "UNIAO" && alvos.length === 0) {
        pendencias.push(`"${ap.documentTypeCode}": regra de união aplicável a ${p.id}, mas a pessoa não tem nenhuma União cadastrada — necessidade não materializada`)
        continue
      }
      const codigoExigivel = codigoExigivelDoTipo(ap.documentTypeCode)
      for (const alvo of alvos) {
        const escolhido = alvo.uniaoId != null
          ? documentoDaUniaoEscolhido((conjugesPorUniao.get(alvo.uniaoId) ?? [p.id]).map(paraFiltro), codigoExigivel)
          : documentoEscolhidoParaPessoa(paraFiltro(p.id), codigoExigivel)
        if (!escolhido) {
          removidasPorEscolha.set(alvo.chave, {
            pessoaId: alvo.pessoaId ?? null, uniaoId: alvo.uniaoId ?? null, chave: alvo.chave,
            varianteKey, itemCatalogoId, regra, ap, sujeitoNome: sujeito.nome ?? `Pessoa ${p.id}`,
          })
          continue
        }
        exigencias.push({
          pessoaId: alvo.pessoaId ?? null, uniaoId: alvo.uniaoId ?? null, chave: alvo.chave,
          varianteKey, itemCatalogoId, regra, ap, sujeitoNome: sujeito.nome ?? `Pessoa ${p.id}`,
        })
      }
    }
  }

  return {
    processoId, tipoProcessoId: processo.tipoProcessoMotorId ?? null, arvoreId: processo.arvoreId,
    exigencias, removidasPorEscolha: [...removidasPorEscolha.values()].filter((r) => !exigencias.some((e) => e.chave === r.chave)),
    pendencias, instancia: instanciaRaw ?? null,
    labelLocalizarRegistro, slaDaysLocalizarRegistro, tipoPorCode,
  }
}

export const FASE_GENEALOGIA = "genealogia" // phaseKey canônica (minúscula)
// stepKey canônico ÚNICO da Genealogia. "Localizar registro" (não "buscar
// documento"/"certidão"): aqui só se LOCALIZA o registro civil e preenchem-se os
// dados registrais. A solicitação/obtenção da certidão é da Emissão Documental.
const STEP_LOCALIZAR = "localizar_registro"
const STEP_LABEL = "Localizar registro da certidão"

export interface MaterializarResultado {
  processoId: number
  aplicaveis: number
  necessidadesCriadas: number
  necessidadesReusadas: number
  documentosCriados: number
  stepsCriados: number
  stepsReusados: number
  dispensadas: number
  reativadas: number
  pendencias: string[]
  semInstanciaWorkflow: boolean
  /** `true` quando o processo está em "Aguardando fechamento": retorno antecipado, nada criado nem reconciliado. */
  aguardandoFechamento?: boolean
  /** FATOS desta rodada, legíveis — alimentam a auditoria e o preview. */
  fatos: FatoNecessidade[]
  /** Necessidades já ATENDIDAS/EM_ATENDIMENTO/NAO_LOCALIZADA cuja causa sumiu: NUNCA dispensadas sozinhas (fato acontecido). */
  preservadasSemCausa: Array<{ necessidadeId: number; status: string; rotulo: string }>
}

export interface FatoNecessidade {
  tipo: "REMOVIDA" | "CRIADA" | "REATIVADA"
  necessidadeId: number
  /** "Certidão de casamento · Edison Nás Antão Junior" */
  rotulo: string
  documentoIds: number[]
  tarefasAbertas: number
}

export interface OpcoesMaterializarGenealogia {
  /** O QUE MUDOU na árvore, em palavras ("pessoa deixou de ser casada"). Sem isto não há auditoria de fato. */
  motivo?: string
  /** Quem alterou (nome legível) e o id — vão na linha de auditoria. */
  autor?: { id: number | null; nome: string | null } | null
}

// ---- contexto canônico da Pessoa (sem legado) ----
export function contextoDaPessoa(p: {
  id: number; nome?: string | null; sobrenome?: string | null
  documentacao: boolean; casado: boolean; vivo: boolean; linhaReta: boolean; requerente: string | null
  data_nasc?: Date | string | null
}, referencia: Date = new Date()): SujeitoContexto {
  // A idade vem da política canônica de maioridade, com data de referência
  // EXPLÍCITA — nunca de "hoje" implícito espalhado pelo código.
  const idade = idadeEmAnos(p.data_nasc ?? null, referencia)
  return {
    id: p.id,
    nome: [p.nome, p.sobrenome].filter(Boolean).join(" ") || `Pessoa ${p.id}`,
    ehPessoaArvore: true,
    precisaDeDocumentacao: p.documentacao === true,
    casado: p.casado === true,
    vivo: p.vivo === true,
    falecido: p.vivo === false,
    // domínio canônico: "sim" | "maior" | "menor" contam como requerente.
    requerente: ehRequerente(p.requerente),
    linhaReta: p.linhaReta === true,
    idade,
    maiorDeIdade: maioridadeEfetiva(p.data_nasc ?? null, p.requerente, referencia),
    dataNascimento: p.data_nasc ? new Date(p.data_nasc).toISOString() : null,
  }
}

// "exigida na Genealogia": fase de exigência OU fase bloqueada = genealogia.
// Regras de identidade/comprovante (protocolo) NÃO entram na Genealogia.
export function exigidaNaGenealogia(r: RegraDocumental): boolean {
  return r.faseExigencia === FASE_GENEALOGIA || r.faseBloqueio === FASE_GENEALOGIA
}
export function aplicaAoProcesso(r: RegraDocumental, tipoProcessoId: number | null): boolean {
  return r.aplicaTodosProcessos || (tipoProcessoId != null && (r.tipoProcessoIds.length ? r.tipoProcessoIds.includes(tipoProcessoId) : r.tipoProcessoId === tipoProcessoId))
}

// ---- regras PUBLICADAS exigidas na Genealogia aplicáveis ao processo ----
export async function regrasGenealogiaDoProcesso(tipoProcessoId: number | null, db: DB = prisma): Promise<RegraDocumental[]> {
  // ARQUIVADA não materializa. Sem este filtro, arquivar a v1 e publicar a v2 da
  // mesma regra deixava as duas materializando: como o `varianteKey` carrega a
  // versão, nasciam DUAS necessidades para a mesma obrigação — a mesma família de
  // duplicidade que a eliminação do segundo motor acabou de fechar.
  const rows = await db.matrizDocumental.findMany({ where: { status: "PUBLICADA", arquivado: false } })
  return rows.map(matrizParaRegra).filter((r) => aplicaAoProcesso(r, tipoProcessoId) && exigidaNaGenealogia(r))
}

function chaveStep(necessidadeId: number, ciclo: number): string {
  return `matdoc|${STEP_LOCALIZAR}|nec${necessidadeId}|c${ciclo}`
}

// ---- núcleo: materializa a Genealogia de UM processo (idempotente) ----
export async function materializarGenealogia(processoId: number, db: DB = prisma, opts: OpcoesMaterializarGenealogia = {}): Promise<MaterializarResultado> {
  const res: MaterializarResultado = {
    processoId, aplicaveis: 0, necessidadesCriadas: 0, necessidadesReusadas: 0, documentosCriados: 0,
    stepsCriados: 0, stepsReusados: 0, dispensadas: 0, reativadas: 0, pendencias: [], semInstanciaWorkflow: false,
    fatos: [], preservadasSemCausa: [],
  }

  // "AGUARDANDO FECHAMENTO" (`a_iniciar`): o contrato ainda não fechou — NADA nasce (nem necessidade, nem documento, nem passo, nem tarefa) e
  // NADA é reconciliado. RETORNO ANTECIPADO de propósito: devolver "zero exigências" cairia na reconciliação abaixo e DISPENSARIA
  // necessidades existentes. Marcar/desmarcar documentos de uma pessoa nessa fase só grava a escolha na Pessoa; ao mover (manualmente) o
  // processo para a Genealogia, `materializarExecucaoDaFase` chama este mesmo núcleo e tudo nasce só do que está marcado.
  const posicao = await db.processo.findUnique({ where: { id: processoId }, select: { faseAtualKey: true } })
  if (ehFaseAguardandoFechamento(posicao?.faseAtualKey)) {
    res.aguardandoFechamento = true
    res.pendencias.push("processo em Aguardando fechamento — nada é materializado até a movimentação para a Genealogia")
    return res
  }

  const calculo = await calcularExigenciasDaGenealogia(processoId, db)
  if (!calculo) { res.pendencias.push("processo sem árvore vinculada"); return res }
  res.pendencias.push(...calculo.pendencias)
  // SEM REGRA PUBLICADA NÃO É "NADA A FAZER": é exigência zero. Retornar aqui deixava
  // as necessidades órfãs (regra inativada/arquivada) vivas para sempre — a
  // reconciliação abaixo as dispensa (PENDENTE) ou as aponta (já andaram).

  const { arvoreId, tipoProcessoId, instancia: instanciaDoCalculo, labelLocalizarRegistro, slaDaysLocalizarRegistro, tipoPorCode } = calculo
  let instancia = instanciaDoCalculo
  if (!instancia) res.semInstanciaWorkflow = true

  // varianteKeys aplicáveis nesta rodada (para reconciliação)
  const aplicaveisVariante = new Set(calculo.exigencias.map((e) => e.chave))

  for (const exigencia of calculo.exigencias) {
      res.aplicaveis++
      const { ap, regra, varianteKey, itemCatalogoId } = exigencia
      const tipoDoc = tipoPorCode.get(ap.documentTypeCode)
      const codigo = regra.codigo ?? `MDX_${regra.id}`

      {
      const alvo = { pessoaId: exigencia.pessoaId ?? undefined, uniaoId: exigencia.uniaoId ?? undefined }

      const snapshot = {
        codigo, requisito: ap.requisitoNome ?? regra.requisitoNome ?? ap.documentTypeCode,
        documentosAceitos: ap.documentosAceitos, modoSatisfacao: ap.modoSatisfacao,
        obrigatoriedade: ap.obrigatoriedade, faseExigencia: regra.faseExigencia, faseBloqueio: regra.faseBloqueio,
        publicoAlvo: regra.publicoAlvo, condicoes: regra.condicoes ?? null,
      } as unknown as Prisma.InputJsonValue
      const { necessidade, criada } = await garantirNecessidade({
        processoId, itemCatalogoId, pessoaId: alvo.pessoaId ?? null, uniaoId: alvo.uniaoId ?? null, varianteKey, origem: "MATRIZ",
        obrigatoriedade: ap.obrigatoriedade, matrizRegraId: regra.id, matrizRegraVersao: regra.versao,
        matrizSnapshot: snapshot, motivoAplicabilidade: ap.justificativa, arvoreId, ruleCode: codigo.slice(0, 20),
      }, db)
      criada ? res.necessidadesCriadas++ : res.necessidadesReusadas++
      if (criada) res.fatos.push({ tipo: "CRIADA", necessidadeId: necessidade.id, rotulo: "", documentoIds: [], tarefasAbertas: 0 })

      // reativa se estava DISPENSADA (voltou a ser aplicável) — via serviço canônico.
      // NUNCA quando a dispensa foi MANUAL (decisão de operador, ex.: cancelar a
      // operação de um documento): a regra ainda achar aplicável não é motivo pra
      // desfazer sozinha o que um humano decidiu encerrar. Reabertura manual passa
      // pelo endpoint "reabrir", que cria necessidade nova — não por aqui.
      if (!criada && necessidade.status === "DISPENSADA" && !necessidade.dispensaManual) {
        await reativarNecessidade(necessidade.id, db)
        res.reativadas++
        res.fatos.push({ tipo: "REATIVADA", necessidadeId: necessidade.id, rotulo: "", documentoIds: [], tarefasAbertas: 0 })
      }

      // DOCUMENTO OPERACIONAL — nasce JUNTO com a necessidade, não mais só no clique
      // manual "Iniciar" (unificação 28/09/2026). Mesma porta que o clique sempre usou
      // (`garantirDocumentoDaNecessidade`, idempotente por advisory lock: reexecutar a
      // materialização nunca duplica). Mesmo gate de elegibilidade do passo logo abaixo
      // (`recebeWorkflowOperacional`) — RG/comprovante/procuração continuam sem
      // Documento operacional aqui, do jeito que já ficam sem passo. Uma necessidade
      // DISPENSADA por decisão manual do operador NÃO ganha Documento (ela não deveria
      // nem existir mais como trabalho a fazer).
      const necessidadeDispensadaManual = !criada && necessidade.status === "DISPENSADA" && necessidade.dispensaManual
      let documentoId: number | null = null
      if (!necessidadeDispensadaManual && recebeWorkflowOperacional(tipoDoc)) {
        const r = await garantirDocumentoDaNecessidade(processoId, necessidade.id, db)
        documentoId = r.documentoId
        if (r.criado) res.documentosCriados++
      }

      // PASSO OPERACIONAL — só para documento cujo PERFIL declara workflow.
      // É o que impede RG, comprovante e procuração de herdarem os cinco passos
      // da emissão de certidão: eles entram na fase como necessidade, sem passo.
      // A distinção vem do perfil cadastrado, não de uma lista de exceções.
      // PESSOA/UNIÃO QUE ENTRA DEPOIS DE A GENEALOGIA CONCLUIR: sem instância ativa o passo "Localizar registro" simplesmente não nascia
      // (processo 683, Fogli) e a Emissão abria a certidão sem os dados registrais. A necessidade que ainda NÃO tem passo de localizar
      // reabre a Genealogia (histórico preservado) e o passo nasce nela. Quem já tem passo (concluído ou cancelado) não reabre nada.
      if (!instancia && recebeWorkflowOperacional(tipoDoc)) {
        const jaTemLocalizar = await db.phaseWorkflowStepInstance.findFirst({
          where: { processoId, stepKey: STEP_LOCALIZAR, necessidadeId: necessidade.id, status: { not: "SUPERSEDIDO" } }, select: { id: true },
        })
        if (!jaTemLocalizar) {
          const r = await reabrirGenealogiaParaNecessidadeTardiaTx(db as Prisma.TransactionClient, processoId, necessidade.id)
          if (r) { instancia = { id: r.id, ciclo: r.ciclo }; res.semInstanciaWorkflow = false }
        }
      }
      if (instancia && recebeWorkflowOperacional(tipoDoc)) {
        const chave = chaveStep(necessidade.id, instancia.ciclo)
        // CONVERGÊNCIA PELA IDENTIDADE LÓGICA, não pela string da chave.
        //
        // O passo desta obrigação pode já ter sido criado pelo materializador do
        // WORKFLOW PUBLICADO, que usa outro formato de chave
        // (`wfi…|stepdef…|…`). Procurar só por `matdoc|…` não encontra nada — e
        // então este caminho cria um SEGUNDO passo para a mesma obrigação, na
        // mesma instância e no mesmo ciclo.
        //
        // Foi o que aconteceu no processo 523: `localizar_registro` da
        // necessidade 190 existia duas vezes na instância 300, um CONCLUÍDO e
        // outro DISPONÍVEL. A certidão mostrava 1/2 enquanto a fase se dizia
        // concluída — cada projeção contava um dos dois.
        //
        // A convergência do lado publicado já era bilateral; esta era de mão
        // única. É a mesma família de defeito das duas tarefas vivas: duas
        // chaves para a mesma coisa, e quem procura numa nunca acha a outra.
        const existente = await db.phaseWorkflowStepInstance.findFirst({
          where: {
            workflowInstanceId: instancia.id,
            ciclo: instancia.ciclo,
            stepKey: STEP_LOCALIZAR,
            necessidadeId: necessidade.id,
            status: { notIn: ["SUPERSEDIDO", "CANCELADO"] },
          },
          select: { id: true },
        })
        if (existente) { res.stepsReusados++ }
        else {
          // A IDENTIDADE (workflow+ciclo+stepKey+necessidade) já pode ter existido
          // e sido CANCELADA — documento invalidado, operação cancelada. A chave de
          // idempotência é a mesma identidade; `create` colidiria (P2002) contra a
          // linha cancelada (achado real: Edithe, processo "Teste" — a colisão
          // ficava só como `prisma:error` no log e a necessidade continuava
          // PENDENTE sem etapa nenhuma pra atender).
          //
          // NÃO é REABRIR essa linha: reabrir aqui já produziu, na prática, DUAS
          // etapas ativas para a mesma necessidade (a matdoc reaberta + a que o
          // lado publicado cria) — a MESMA família de defeito do processo 523
          // que o comentário acima descreve, só que provocada por este reparo em
          // vez de evitada por ele. A necessidade já existe e está PENDENTE (a
          // duas linhas acima); é ELA, não este passo local, que
          // `instanciarWorkflowDaFase` lê para materializar a etapa real, pelo
          // formato bilateral (`wfi…`) — que já sabe reconhecer um passo `matdoc`
          // ativo e não duplicá-lo. Este caminho só precisa PARAR DE MORRER: se a
          // identidade já tem uma linha (viva ou cancelada), não há nada a criar.
          const jaExiste = await db.phaseWorkflowStepInstance.findUnique({
            where: { chaveIdempotencia: chave },
            select: { id: true },
          })
          if (jaExiste) {
            res.stepsReusados++
          } else {
            await db.phaseWorkflowStepInstance.create({
              data: {
                workflowInstanceId: instancia.id, stepKey: STEP_LOCALIZAR, processoId,
                faseMacroKey: FASE_GENEALOGIA, ordem: 1, tipo: "HUMANO",
                // `geraTarefa` NÃO é mais decisão deste materializador — nem aqui
                // nem em lugar nenhum. Ele descreve a ETAPA; quem responde "este
                // trabalho entra na fila de alguém?" é a TAREFA da instância,
                // materializada pelo reconciliador canônico
                // (lib/operacional/reconciliar-tarefas.ts).
                //
                // O literal `false` que ficava aqui era uma decisão de negócio
                // escondida num materializador local: ela deixou a operação
                // inteira do Ademir invisível para a fila, o prazo e as
                // notificações, sem erro e sem aviso. O valor abaixo é só o
                // default do modelo, e nada o lê para decidir tarefa.
                obrigatorio: ap.obrigatoriedade === "OBRIGATORIA", ciclo: instancia.ciclo,
                status: "DISPONIVEL", necessidadeId: necessidade.id, documentoId,
                papel: "equipe_documental", slaDays: slaDaysLocalizarRegistro,
                chaveIdempotencia: chave,
                snapshot: { stepKey: STEP_LOCALIZAR, label: labelLocalizarRegistro, requisito: snapshot } as Prisma.InputJsonValue,
                snapshotSchemaVersion: 1,
              },
            })
            res.stepsCriados++
          }
        }
      }
      }
  }

  const finalizado = await reconciliarEfinalizar(res, processoId, aplicaveisVariante, db, opts)

  // DOCUMENTO AUTOMÁTICO SEM NECESSIDADE (órfão) sai de jogo, com os passos dele.
  await tirarDocumentosOrfaosDeJogo(processoId, db, opts.motivo ? `necessidade removida pela árvore: ${opts.motivo}` : undefined)

  // A TAREFA DO TRABALHO converge junto com a materialização: sair daqui com
  // workflow ativo e sem tarefa é exatamente o estado em que o Ademir ficou.
  // Participa da transação de quem chamou (`db`): o reconciliador é tx-aware e
  // nunca escreve fora dela.
  await contarTarefasAbertasDosFatos(finalizado, db)
  await reconciliarTarefas({ processoId, db })
  await reconciliarGenealogiaEEmissaoTx(db as Prisma.TransactionClient, processoId)
  // O DONO da certidão de casamento é recalculado a cada reconciliação (mudança de linha reta ou de documentos exigidos passa por aqui).
  await reapontarDonoDoCasamento(processoId, db, { motivo: "reconciliação: o dono da certidão de casamento é o cônjuge da linha reta que a mantém", autorId: opts.autor?.id ?? null })
  await auditarFatos(finalizado, processoId, db, opts)

  return finalizado
}

async function reconciliarEfinalizar(
  res: MaterializarResultado, processoId: number, aplicaveisVariante: Set<string>, db: DB,
  opts: OpcoesMaterializarGenealogia = {},
): Promise<MaterializarResultado> {
  // ---- reconciliação: necessidades desta origem que deixaram de ser aplicáveis ----
  const existentes = await db.necessidadeDocumental.findMany({
    where: { processoId, origem: "MATRIZ", varianteKey: { startsWith: "rd:" } },
    select: { id: true, pessoaId: true, uniaoId: true, varianteKey: true, status: true },
  })
  for (const n of existentes) {
    // MESMA convenção de chave usada ao materializar (pXX / uXX) — sujeito é
    // SEMPRE um dos dois (pessoaId XOR uniaoId), nunca os dois.
    const chaveAplic = n.pessoaId != null ? `p${n.pessoaId}::${n.varianteKey}` : `u${n.uniaoId}::${n.varianteKey}`
    if (aplicaveisVariante.has(chaveAplic)) continue
    // deixou de ser aplicável: se ainda não começou (PENDENTE), DISPENSA (reversível);
    // se já em atendimento/atendida/não localizada → preserva histórico, não mexe
    // (DECISÃO CONSERVADORA: o que já foi atendido é fato acontecido; o sistema só
    // APONTA — ARV-001 — e nunca dispensa sozinho).
    if (n.status === "PENDENTE") {
      const motivo = opts.motivo ? `necessidade removida pela árvore: ${opts.motivo}` : "Regra deixou de ser aplicável (reconciliação)"
      const r = await dispensarNecessidade(n.id, motivo, db, false, { usuarioId: opts.autor?.id ?? null, origem: opts.autor?.nome ? "alteração na árvore" : "reconciliação da Genealogia" })
      res.dispensadas++
      res.fatos.push({ tipo: "REMOVIDA", necessidadeId: n.id, rotulo: "", documentoIds: r.documentoIds, tarefasAbertas: 0 })
    } else if (n.status === "EM_ATENDIMENTO" || n.status === "ATENDIDA" || n.status === "NAO_LOCALIZADA") {
      res.preservadasSemCausa.push({ necessidadeId: n.id, status: n.status, rotulo: "" })
    }
  }

  return res
}

/** "Certidão de casamento · Edison Nás Antão Junior" — nome do Cadastro Mestre + pessoa (titular, se união). */
export async function rotuloDaNecessidade(db: DB, necessidadeId: number): Promise<string> {
  const n = await db.necessidadeDocumental.findUnique({
    where: { id: necessidadeId },
    select: {
      itemCatalogo: { select: { name: true } },
      pessoa: { select: { nome: true, sobrenome: true } },
      uniao: { select: { ...SELECT_UNIAO_PARA_TITULAR } },
    },
  })
  if (!n) return `Necessidade #${necessidadeId}`
  let nome = n.pessoa ? [n.pessoa.nome, n.pessoa.sobrenome].filter(Boolean).join(" ") : null
  if (!nome && n.uniao) {
    const tid = titularDaUniao(n.uniao)
    const p = tid ? await db.pessoa.findUnique({ where: { id: tid }, select: { nome: true, sobrenome: true } }) : null
    nome = p ? [p.nome, p.sobrenome].filter(Boolean).join(" ") : null
  }
  return `${n.itemCatalogo?.name ?? "Documento"}${nome ? ` · ${nome}` : ""}`
}

const STATUS_NAO_ABERTA_TAREFA = ["CONCLUIDO_RECEBIDO", "CONCLUIDO_NAO_POSSUI", "CANCELADA", "SUPERSEDIDA"] as const

/** Preenche rótulo e conta as tarefas ABERTAS de cada fato REMOVIDO (antes de a varredura cancelá-las). */
async function contarTarefasAbertasDosFatos(res: MaterializarResultado, db: DB): Promise<void> {
  for (const f of res.fatos) {
    f.rotulo = await rotuloDaNecessidade(db, f.necessidadeId)
    if (f.tipo !== "REMOVIDA") continue
    f.tarefasAbertas = await db.tarefa.count({
      where: {
        OR: [{ necessidadeId: f.necessidadeId }, ...(f.documentoIds.length ? [{ documentoId: { in: f.documentoIds } }] : [])],
        statusTarefa: { notIn: [...STATUS_NAO_ABERTA_TAREFA] },
      },
    })
  }
  for (const pv of res.preservadasSemCausa) pv.rotulo = await rotuloDaNecessidade(db, pv.necessidadeId)
}

/** UMA linha de auditoria legível por fato — dentro da mesma transação da mudança. */
async function auditarFatos(res: MaterializarResultado, processoId: number, db: DB, opts: OpcoesMaterializarGenealogia): Promise<void> {
  if (!opts.motivo) return
  const quem = opts.autor?.nome ? ` (alterado por ${opts.autor.nome})` : ""
  const usuarioId = opts.autor?.id ?? null
  for (const f of res.fatos) {
    const acao = f.tipo === "REMOVIDA" ? "NECESSIDADE_REMOVIDA_PELA_ARVORE" : f.tipo === "CRIADA" ? "NECESSIDADE_CRIADA_PELA_ARVORE" : "NECESSIDADE_REATIVADA_PELA_ARVORE"
    const verbo = f.tipo === "REMOVIDA" ? "removida" : f.tipo === "CRIADA" ? "criada" : "reativada"
    const cauda = f.tipo === "REMOVIDA" && f.tarefasAbertas > 0 ? `; ${f.tarefasAbertas} tarefa(s) aberta(s) tratada(s)` : ""
    await db.logAuditoria.create({
      data: {
        acao, entidade: "NecessidadeDocumental", entidadeId: f.necessidadeId, usuarioId,
        descricao: `Necessidade '${f.rotulo}' ${verbo}: ${opts.motivo}${quem}${cauda}`,
        detalhes: { processoId, documentoIds: f.documentoIds, tarefasAbertas: f.tarefasAbertas, motivo: opts.motivo } as Prisma.InputJsonValue,
      },
    })
  }
  for (const pv of res.preservadasSemCausa) {
    // UM AVISO POR SITUAÇÃO (06/10/2026, caso Attilio: 11 linhas iguais durante uma sequência de edições): se o último registro desta
    // necessidade já é este mesmo aviso, a situação não mudou — nada novo a registrar.
    const ultimo = await db.logAuditoria.findFirst({
      where: { entidade: "NecessidadeDocumental", entidadeId: pv.necessidadeId, acao: { startsWith: "NECESSIDADE_" } },
      orderBy: { id: "desc" }, select: { acao: true },
    })
    if (ultimo?.acao === "NECESSIDADE_ATENDIDA_SEM_CAUSA" || ultimo?.acao === "NECESSIDADE_ATENDIDA_SEM_CAUSA_CONSOLIDADO") continue
    await db.logAuditoria.create({
      data: {
        acao: "NECESSIDADE_ATENDIDA_SEM_CAUSA", entidade: "NecessidadeDocumental", entidadeId: pv.necessidadeId, usuarioId,
        descricao: `Necessidade '${pv.rotulo}' (${pv.status}) deixou de ser exigida pela árvore (${opts.motivo})${quem}, mas já andou — NÃO foi dispensada; requer decisão humana.`,
        detalhes: { processoId, status: pv.status, motivo: opts.motivo } as Prisma.InputJsonValue,
      },
    })
  }
}

const STATUS_DOC_NAO_RECEBIDO = ["PENDENTE", "SOLICITAR", "SOLICITADO", "EM_BUSCA", "NAO_ENCONTRADO"] as const

/**
 * DOCUMENTO AUTOMÁTICO SEM NECESSIDADE (órfão) sai de jogo: NAO_EXIGIDO + passos
 * abertos cancelados (a tarefa converge pela varredura). Só documentos de origem
 * `automatica` ainda NÃO recebidos — documento que já tem papel/recebimento nunca é
 * mexido aqui (ARV-001 apenas o aponta). Idempotente.
 */
export async function tirarDocumentosOrfaosDeJogo(processoId: number, db: DB, motivo = "necessidade removida pela árvore: o documento não tem necessidade ativa"): Promise<number[]> {
  const proc = await db.processo.findUnique({ where: { id: processoId }, select: { arvoreId: true } })
  if (!proc?.arvoreId) return []
  const orfaos = await db.documento.findMany({
    where: {
      pessoa: { arvoreId: proc.arvoreId }, origem: "automatica", necessidadeId: null,
      status: { in: [...STATUS_DOC_NAO_RECEBIDO] },
    },
    select: { id: true },
  })
  if (orfaos.length === 0) return []
  const ids = orfaos.map((d) => d.id)
  await db.documento.updateMany({
    where: { id: { in: ids } },
    data: { status: "NAO_EXIGIDO", motivoBloqueio: MOTIVO_DOCUMENTO_DISPENSADO, ultimaMovimentacao: new Date() },
  })
  const passos = await db.phaseWorkflowStepInstance.findMany({
    where: { documentoId: { in: ids }, status: { notIn: ["CONCLUIDO", "SUPERSEDIDO", "CANCELADO", "DISPENSADO"] } },
    select: { id: true, ciclo: true, processoId: true, workflowInstanceId: true },
  })
  const correlationId = randomUUID()
  for (const p of passos) {
    await transicionarPassoTx(db as Prisma.TransactionClient, p.id, "CANCELADO", {
      correlationId, operacao: "documento-orfao-fora-de-jogo", ciclo: p.ciclo,
      processoId: p.processoId, workflowInstanceId: p.workflowInstanceId,
      extra: { cancelledAt: new Date(), motivo },
    })
  }
  for (const id of ids) {
    await db.logAuditoria.create({
      data: {
        acao: "DOCUMENTO_ORFAO_NAO_EXIGIDO", entidade: "Documento", entidadeId: id,
        descricao: `Documento #${id} sem necessidade ativa passou a NAO_EXIGIDO — ${motivo}.`,
        detalhes: { processoId } as Prisma.InputJsonValue,
      },
    })
  }
  return ids
}

// ---- gatilho best-effort: ao criar/editar Pessoa, reavalia a Genealogia dos
// processos da árvore dela. NUNCA lança (não pode quebrar o CRUD de Pessoa). ----
export async function dispararMaterializacaoPorArvore(arvoreId: number | null | undefined): Promise<void> {
  if (!arvoreId) return
  try {
    // Nº LINHAGEM primeiro: qualquer edição de árvore (novo ancestral, novo
    // filho, cônjuge vinculado/desvinculado, data de nascimento corrigida) pode
    // mudar a ordem — e é o MESMO gatilho único de sempre, sem ponto de
    // chamada novo espalhado pelo app.
    try { await recalcularNumerosLinhagemDaArvore(arvoreId) } catch (e) { console.error(`[genealogia] Nº Linhagem da árvore ${arvoreId} falhou (fluxo seguiu):`, e) }

    const procs = await prisma.processo.findMany({ where: { arvoreId }, select: { id: true } })
    for (const p of procs) {
      // CONVERGÊNCIA OFICIAL primeiro. Este é o elo causal que faltava: no fluxo
      // real o processo nasce ANTES da árvore, e a fase inicial foi materializada
      // com zero pessoa. Quando a pessoa aparece, a fase precisa convergir — pelo
      // materializador ÚNICO, não por um caminho paralelo.
      //
      // `materializarGenealogia` (abaixo) continua sendo a origem MATRIZ das
      // exigências e depende de Regra Documental publicada; sem nenhuma publicada
      // ela retorna cedo, e era por isso que este gatilho não fazia nada.
      try {
        await materializarExecucaoDaFase({ processoId: p.id, fonte: "RECONCILIACAO" })
      } catch (e) {
        console.error(`[genealogia] convergência oficial do processo ${p.id} falhou (fluxo seguiu):`, e)
      }
      try { await materializarGenealogia(p.id) } catch (e) { console.error(`[genealogia] materializar processo ${p.id} falhou (fluxo seguiu):`, e) }
      // EVENTO OPERACIONAL "REQUERENTES_DO_PROCESSO_DEFINIDOS/ATUALIZADOS": mudou a árvore
      // (inclui a marcação de requerente) → o FinanceRuleEngine recalcula os honorários da
      // cidadania italiana (1 lançamento consolidado por processo). Best-effort, idempotente.
      try { await aplicarHonorariosCidadaniaItaliana(p.id) } catch (e) { console.error(`[honorarios] processo ${p.id} falhou (fluxo seguiu):`, e) }
      // AVANÇO AUTOMÁTICO — a última pendência pode ter caído por AQUI (vincular
      // requerente, remover pessoa, importar árvore), não por conclusão de
      // passo/documento. Sem isto o processo ficava com o gate satisfeito e
      // esperando a varredura horária do cron (mesma classe do processo 523,
      // documentada em reconciliar-motor-fases.ts) para uma pendência que a
      // própria reconciliação que está rodando agora acabou de resolver.
      // `origem: "cron-reconciliacao"` de propósito — é a MESMA trava que impede
      // fase "processo" (checklist manual) de avançar sozinha por reconciliação
      // (o incidente do processo 573: 0 exigido virando "100% = avança sozinho").
      try {
        await reconciliarMotorDeFases(p.id, { origem: "cron-reconciliacao" })
      } catch (e) {
        console.error(`[genealogia] reconciliação de fase do processo ${p.id} falhou (fluxo seguiu):`, e)
      }
    }
  } catch (e) {
    console.error("[genealogia] disparo por árvore falhou (fluxo seguiu):", e)
  }
}


/**
 * NOME PÚBLICO DO RECONCILIADOR (mandato "nunca mais árvore ↔ documentação",
 * 29/09/2026). `materializarGenealogia` é a implementação; este é o nome pelo
 * qual toda gravação de Pessoa/União/linhagem e a verificação de Saúde (NEC-001)
 * o chamam — deriva de árvore + matriz + `documentacao` o conjunto esperado de
 * necessidades e ajusta necessidade/Documento/Tarefa (cria, reativa, dispensa +
 * cancela) até bater, na mesma transação de quem chama.
 */
export const reconciliarNecessidades = materializarGenealogia
