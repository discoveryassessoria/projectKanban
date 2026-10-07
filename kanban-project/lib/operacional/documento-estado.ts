// lib/operacional/documento-estado.ts
// ============================================================================
// O ESTADO OPERACIONAL DE UM DOCUMENTO — nunca `Documento.status`.
//
// `Documento.status` (enum `StatusDocumento`, 15 valores) é o workflow escrito
// uma SEGUNDA vez (ver memória "documento-status-legado", decisão de
// 26/08/2026). Só um punhado dos seus valores ainda é gravado por caminhos
// específicos (upload do cliente, invalidar/cancelar, os efeitos de domínio) —
// a maioria congela no que foi escrito uma vez e nunca mais muda, mesmo que a
// Tarefa dona do documento já tenha avançado dez passos.
//
// A pergunta real ("em que pé está este documento, agora?") só a TAREFA
// responde — é ela que o motor atualiza a cada transição. Este módulo é a
// ÚNICA leitura oficial dessa pergunta: acha, para cada `documentoId`, a
// Tarefa VIVA (não terminal) mais recente ligada a ele, e diz se alguma
// Tarefa desse documento já concluiu com sucesso alguma vez.
// ============================================================================
import { prisma } from "@/lib/prisma"
import { colunaDaTarefa, type ColunaKanban } from "./tarefa-projecoes"
import type { StatusTarefa } from "@prisma/client"

const STATUS_TERMINAL_SUCESSO: StatusTarefa[] = ["CONCLUIDO_RECEBIDO"]
const STATUS_TERMINAL: StatusTarefa[] = ["CONCLUIDO_RECEBIDO", "CONCLUIDO_NAO_POSSUI", "CANCELADA", "SUPERSEDIDA"]

// ─── RECEBIDA × VALIDADA — UMA lógica, no servidor (07/10/2026) ──────────────────────────────────────────────────────────────────────
// Localizar registro (Genealogia) NÃO recebe nem valida a certidão: só preenche dados registrais e árvore. A Tarefa da Genealogia termina em
// CONCLUIDO_RECEBIDO — o MESMO valor de qualquer tarefa que conclui com sucesso — e ler «alguma tarefa concluída» fazia a bolinha da árvore dizer
// «Recebido» e a aba Documentos dizer «Validada» sem que a Emissão tivesse começado.
//   RECEBIDA  = «Receber certidão» concluída na Emissão (Registrar recebimento), ou receber_certidao_retificada, ou a Tarefa de Emissão concluída,
//               ou o recebimento direto (upload do cliente/lote, que grava Documento.status RECEBIDO/ENTREGUE).
//   VALIDADA  = «Conferir e validar certidão» concluída (passo 4), ou a Tarefa de Emissão concluída (que só conclui com os 4 passos).
// Tarefa da Genealogia NUNCA conta. A bolinha da árvore, a coluna «Certidão» e as contagens leem esta função e nenhuma outra.
export const FASE_GENEALOGIA = "genealogia"
export const SUBTAREFAS_DE_RECEBIMENTO = ["receber_certidao", "receber_certidao_retificada"] as const
export const SUBTAREFAS_DE_VALIDACAO = ["conferir_validar_certidao", "conferir_validar_certidao_retificada"] as const
export const STATUS_DOCUMENTO_DE_RECEBIMENTO_DIRETO = ["RECEBIDO", "ENTREGUE"] as const

export interface EvidenciasDaCertidao {
  /** `Documento.status` gravado por upload do cliente / lote de arquivos. */
  statusDocumento: string | null
  /** Subtarefa de recebimento CONCLUÍDA na Emissão. */
  recebimentoRegistrado: boolean
  /** Subtarefa «Conferir e validar» CONCLUÍDA na Emissão. */
  validacaoRegistrada: boolean
  /** Tarefa CONCLUIDO_RECEBIDO de fase DIFERENTE da Genealogia (a Emissão concluiu os 4 passos). */
  tarefaDeEmissaoConcluida: boolean
}
export function etapaDaCertidao(ev: EvidenciasDaCertidao): { recebida: boolean; validada: boolean } {
  const validada = ev.validacaoRegistrada || ev.tarefaDeEmissaoConcluida
  const recebida = validada || ev.recebimentoRegistrado || (ev.statusDocumento != null && (STATUS_DOCUMENTO_DE_RECEBIMENTO_DIRETO as readonly string[]).includes(ev.statusDocumento))
  return { recebida, validada }
}

export interface EstadoDocumento {
  documentoId: number
  /** A Tarefa viva (não terminal) mais recente deste documento, se existir. */
  tarefaViva: {
    id: number
    statusTarefa: StatusTarefa
    motivoCodigo: string | null
    coluna: ColunaKanban | null
    responsavelId: number | null
    faseMacroKey: string | null
    dataPrazo: Date | null
  } | null
  /** A certidão foi RECEBIDA (ver `etapaDaCertidao`) — a Tarefa da Genealogia não conta. */
  jaRecebido: boolean
  /** A certidão foi VALIDADA (passo 4 da Emissão concluído) — implica `jaRecebido`. */
  validado: boolean
  /** Nenhuma Tarefa nunca existiu para este documento — ninguém começou. */
  nuncaIniciado: boolean
}

/**
 * Lê o estado de vários documentos de uma vez (uma consulta, não N).
 */
export async function estadoOperacionalDosDocumentos(documentoIds: number[]): Promise<Map<number, EstadoDocumento>> {
  const mapa = new Map<number, EstadoDocumento>()
  if (documentoIds.length === 0) return mapa

  const [docs, execucoes] = await Promise.all([
    prisma.documento.findMany({ where: { id: { in: documentoIds } }, select: { id: true, status: true } }),
    prisma.subtaskExecution.findMany({
      where: { supersededAt: null, status: "CONCLUIDO", subtaskKey: { in: [...SUBTAREFAS_DE_RECEBIMENTO, ...SUBTAREFAS_DE_VALIDACAO] }, stepInstance: { documentoId: { in: documentoIds } } },
      select: { subtaskKey: true, stepInstance: { select: { documentoId: true } } },
    }),
  ])
  const statusDoc = new Map(docs.map((d) => [d.id, d.status as string]))
  const recebimentoPorDoc = new Set<number>(), validacaoPorDoc = new Set<number>()
  for (const e of execucoes) {
    const id = e.stepInstance.documentoId
    if (id == null) continue
    if ((SUBTAREFAS_DE_RECEBIMENTO as readonly string[]).includes(e.subtaskKey)) recebimentoPorDoc.add(id)
    else validacaoPorDoc.add(id)
  }
  const tarefas = await prisma.tarefa.findMany({
    where: { documentoId: { in: documentoIds } },
    select: {
      id: true, documentoId: true, statusTarefa: true, motivoCodigo: true,
      responsavelId: true, faseMacroKey: true, dataPrazo: true, createdAt: true,
    },
    orderBy: { createdAt: "desc" },
  })

  const porDocumento = new Map<number, typeof tarefas>()
  for (const t of tarefas) {
    if (t.documentoId == null) continue
    const arr = porDocumento.get(t.documentoId) ?? []
    arr.push(t)
    porDocumento.set(t.documentoId, arr)
  }

  for (const documentoId of documentoIds) {
    const doDocumento = porDocumento.get(documentoId) ?? []
    const viva = doDocumento.find((t) => !STATUS_TERMINAL.includes(t.statusTarefa)) ?? null
    const etapa = etapaDaCertidao({
      statusDocumento: statusDoc.get(documentoId) ?? null,
      recebimentoRegistrado: recebimentoPorDoc.has(documentoId),
      validacaoRegistrada: validacaoPorDoc.has(documentoId),
      tarefaDeEmissaoConcluida: doDocumento.some((t) => STATUS_TERMINAL_SUCESSO.includes(t.statusTarefa) && t.faseMacroKey !== FASE_GENEALOGIA),
    })
    mapa.set(documentoId, {
      documentoId,
      tarefaViva: viva
        ? {
            id: viva.id,
            statusTarefa: viva.statusTarefa,
            motivoCodigo: viva.motivoCodigo,
            coluna: colunaDaTarefa(viva),
            responsavelId: viva.responsavelId,
            faseMacroKey: viva.faseMacroKey,
            dataPrazo: viva.dataPrazo,
          }
        : null,
      jaRecebido: etapa.recebida,
      validado: etapa.validada,
      nuncaIniciado: doDocumento.length === 0,
    })
  }
  return mapa
}

// ============================================================================
// RÓTULO — a MESMA leitura em toda tela que mostra o estado de UM documento
// (Árvore Genealógica, Pesquisar Documentos, Biblioteca do Kanban, card do
// processo). Nunca reimplementar: um segundo `statusShortMap` diverge do
// primeiro assim que uma coluna nova nascer.
// ============================================================================

export const ROTULO_CURTO_ESTADO: Record<string, string> = {
  PENDENTE: "não iniciado",
  RECEBIDO: "recebido",
  INVALIDO: "inválido",
  NAO_ENCONTRADO: "não encontrado",
  CANCELADO: "cancelado",
  NAO_EXIGIDO: "não exigido",
  // Vocabulário de `ColunaKanban` — a Tarefa VIVA do documento, não o campo
  // congelado. Mesmos rótulos usados em Minha Operação/Tarefas e Projetos.
  SEM_RESPONSAVEL: "sem responsável",
  A_FAZER: "a fazer",
  EM_ANDAMENTO: "em andamento",
  AGUARDANDO_TERCEIRO: "aguardando terceiros",
  BLOQUEADA: "bloqueado",
}

export function classeCompactaDoEstado(status: string): string {
  if (status === "PENDENTE") return "pending"
  if (status === "RECEBIDO") return "received"
  if (["INVALIDO", "NAO_ENCONTRADO"].includes(status)) return "returned"
  if (status === "CANCELADO" || status === "NAO_EXIGIDO") return "returned"
  if (status === "AGUARDANDO_TERCEIRO") return "searching"
  if (status === "SEM_RESPONSAVEL" || status === "A_FAZER") return "requesting"
  if (status === "EM_ANDAMENTO") return "waiting"
  if (status === "BLOQUEADA") return "waiting"
  return "other"
}

/**
 * `Documento.status` congela (memória "documento-status-legado") — só estes
 * três valores ainda são escritos ao vivo por um caminho fora do motor de
 * Tarefa (`controlarOperacaoV2` invalidar/cancelar): são a EXCEÇÃO que ainda
 * vale ler direto do campo, por cima de qualquer Tarefa. Tudo o resto
 * (SOLICITADO/EM_BUSCA/EM_ANALISE/RETIFICANDO/...) é congelado e precisa vir
 * da Tarefa viva — nunca do campo.
 */
export const OVERRIDES_AINDA_VIVOS = new Set(["INVALIDO", "NAO_ENCONTRADO", "CANCELADO", "NAO_EXIGIDO"])

export interface RotuloDoEstado {
  status: string
  statusShort: string
  statusClass: string
  /** Recebida (inclui validada). */
  isRecebido: boolean
  /** Validada: o passo 4 da Emissão foi concluído. */
  isValidado: boolean
  emOperacao: boolean
}

/** O estado real de um documento — a Tarefa viva, nunca `Documento.status` congelado. */
export function rotularEstadoDoDocumento(rawStatus: string, estado: EstadoDocumento | undefined): RotuloDoEstado {
  const rotular = (status: string) => ({
    status,
    statusShort: ROTULO_CURTO_ESTADO[status] ?? status.toLowerCase(),
    statusClass: classeCompactaDoEstado(status),
  })
  if (OVERRIDES_AINDA_VIVOS.has(rawStatus)) {
    return { ...rotular(rawStatus), isRecebido: false, isValidado: false, emOperacao: false }
  }
  const viva = estado?.tarefaViva
  if (viva) {
    // Tarefa viva: o rótulo é o da operação; mas o recebimento já registrado (passo 3) e a validação (passo 4) continuam valendo para a coluna «Certidão».
    return { ...rotular(viva.coluna ?? "EM_ANDAMENTO"), isRecebido: estado?.jaRecebido === true, isValidado: estado?.validado === true, emOperacao: true }
  }
  if (estado?.jaRecebido) {
    return { ...rotular("RECEBIDO"), isRecebido: true, isValidado: estado.validado === true, emOperacao: false }
  }
  return { ...rotular("PENDENTE"), isRecebido: false, isValidado: false, emOperacao: false }
}

// ─── A BOLINHA DA CERTIDÃO NA ÁRVORE — também uma regra só, no servidor ───────────────────────────────────────────────────────────────
// Toda certidão EXIGIDA da pessoa tem bolinha. Pendente (ainda a solicitar) é laranja — mesmo com o registro já localizado na Genealogia, que não
// esconde a bolinha nem a torna azul. Azul = recebida (passo «Registrar recebimento» concluído; validada continua azul). Só sai da árvore quem não é
// mais exigido (cancelado / não exigido). A tela não decide cor: lê `bolinha`.
export type BolinhaDaCertidao = "em_busca" | "solicitar" | "solicitado" | "recebido"
export function bolinhaDaCertidao(r: RotuloDoEstado): BolinhaDaCertidao | null {
  if (r.isRecebido) return "recebido"
  switch (r.status) {
    case "BLOQUEADA": case "INVALIDO": case "NAO_ENCONTRADO": return "em_busca"
    case "PENDENTE": case "SEM_RESPONSAVEL": case "A_FAZER": return "solicitar"
    case "AGUARDANDO_TERCEIRO": case "EM_ANDAMENTO": return "solicitado"
    default: return null // CANCELADO / NAO_EXIGIDO: a exigência acabou
  }
}
