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
  /** Alguma Tarefa deste documento já concluiu com sucesso, em qualquer fase. */
  jaRecebido: boolean
  /** Nenhuma Tarefa nunca existiu para este documento — ninguém começou. */
  nuncaIniciado: boolean
}

/**
 * Lê o estado de vários documentos de uma vez (uma consulta, não N).
 */
export async function estadoOperacionalDosDocumentos(documentoIds: number[]): Promise<Map<number, EstadoDocumento>> {
  const mapa = new Map<number, EstadoDocumento>()
  if (documentoIds.length === 0) return mapa

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
      jaRecebido: doDocumento.some((t) => STATUS_TERMINAL_SUCESSO.includes(t.statusTarefa)),
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
  // Vocabulário de `ColunaKanban` — a Tarefa VIVA do documento, não o campo
  // congelado. Mesmos rótulos usados em Minha Operação/Tarefas e Projetos.
  SEM_RESPONSAVEL: "sem responsável",
  A_FAZER: "a fazer",
  EM_ANDAMENTO: "em andamento",
  AGUARDANDO_TERCEIRO: "aguardando terceiro",
  BLOQUEADA: "bloqueado",
}

export function classeCompactaDoEstado(status: string): string {
  if (status === "PENDENTE") return "pending"
  if (status === "RECEBIDO") return "received"
  if (["INVALIDO", "NAO_ENCONTRADO"].includes(status)) return "returned"
  if (status === "CANCELADO") return "returned"
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
export const OVERRIDES_AINDA_VIVOS = new Set(["INVALIDO", "NAO_ENCONTRADO", "CANCELADO"])

export interface RotuloDoEstado {
  status: string
  statusShort: string
  statusClass: string
  isRecebido: boolean
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
    return { ...rotular(rawStatus), isRecebido: false, emOperacao: false }
  }
  const viva = estado?.tarefaViva
  if (viva) {
    return { ...rotular(viva.coluna ?? "EM_ANDAMENTO"), isRecebido: false, emOperacao: true }
  }
  if (estado?.jaRecebido) {
    return { ...rotular("RECEBIDO"), isRecebido: true, emOperacao: false }
  }
  return { ...rotular("PENDENTE"), isRecebido: false, emOperacao: false }
}
