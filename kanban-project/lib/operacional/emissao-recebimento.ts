// lib/operacional/emissao-recebimento.ts
// ============================================================================
// "AGUARDANDO O CARTÓRIO" E "REGISTRAR RECEBIMENTO" (Operação, 07/10/2026) — as regras PURAS, num lugar só.
//
// A certidão da Emissão documental está aguardando o cartório quando o requerimento JÁ FOI ENVIADO (subtarefa 1 concluída) e o
// recebimento AINDA NÃO foi registrado (subtarefa 3 não concluída) — tenha ou não responsável, esteja a subtarefa corrente em
// "aguardando terceiro", "disponível" ou "bloqueada", vencida ou não. O prazo de cobrança (10 dias, o SLA do passo) é só lembrete:
// não trava nada.
//
// "Registrar recebimento" é UMA ação, a qualquer momento depois do envio: conclui a 2 (Receber confirmação do pedido) e a 3 (Receber
// certidão) e deixa a 4 (Conferir e validar) liberada. Nada exige anexo, comprovante ou campo preenchido — o que conclui é a ação da
// pessoa, e a data pode ser de meses atrás.
// ============================================================================

import { rotuloStatusTarefa } from '@/src/lib/home/rotulo-status-tarefa'

export const SUBTAREFA_PEDIDO_ENVIADO = 'enviar_requerimento_cartorio'
export const SUBTAREFA_CONFIRMACAO = 'receber_confirmacao_pedido'
export const SUBTAREFA_CERTIDAO_RECEBIDA = 'receber_certidao'
export const SUBTAREFA_CONFERENCIA = 'conferir_validar_certidao'

export type StatusPorSubtarefa = Readonly<Record<string, string>>

/** Pedido enviado e recebimento ainda não registrado. */
export function aguardandoOCartorio(status: StatusPorSubtarefa | null | undefined): boolean {
  if (!status) return false
  return status[SUBTAREFA_PEDIDO_ENVIADO] === 'CONCLUIDO' && status[SUBTAREFA_CERTIDAO_RECEBIDA] != null && status[SUBTAREFA_CERTIDAO_RECEBIDA] !== 'CONCLUIDO'
}

export interface QuemPodeRegistrar { tipo: string; userId: number; responsavelId: number | null; pedidoPorId: number | null }

/** Quem fez o pedido (executou a subtarefa 1), o responsável da tarefa e o administrador (o Marco vê e faz tudo). */
export function podeRegistrarRecebimento(q: QuemPodeRegistrar): boolean {
  if (q.tipo === 'admin') return true
  return (q.responsavelId != null && q.responsavelId === q.userId) || (q.pedidoPorId != null && q.pedidoPorId === q.userId)
}

const doisDigitos = (n: number) => String(n).padStart(2, '0')

/** "07/10" — a data no fuso operacional (São Paulo), sem ano quando é o ano corrente. */
export function diaMes(iso: string | Date, agora: Date = new Date()): string {
  const d = iso instanceof Date ? iso : new Date(iso)
  const partes = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric' }).formatToParts(d)
  const get = (t: string) => partes.find((p) => p.type === t)?.value ?? ''
  const anoAgora = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', year: 'numeric' }).format(agora)
  return get('year') === anoAgora ? `${get('day')}/${get('month')}` : `${get('day')}/${get('month')}/${get('year')}`
}

/** A frase do histórico: "Recebida em 07/10 · registrado por Daniela Brait". */
export function textoDoRecebimento(recebidaEm: string | Date, quem: string, agora: Date = new Date()): string {
  return `Recebida em ${diaMes(recebidaEm, agora)} · registrado por ${quem}`
}

/** A data de recebimento digitada (AAAA-MM-DD) → meio-dia em São Paulo (nunca vira o dia anterior por fuso). `null` = inválida ou no futuro. */
export function dataDeRecebimento(entrada: string | null | undefined, agora: Date = new Date()): Date | null {
  if (!entrada) return null
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(entrada.trim())
  if (!m) return null
  const [, a, mes, d] = m
  const data = new Date(`${a}-${mes}-${d}T12:00:00-03:00`)
  if (Number.isNaN(data.getTime())) return null
  // 31/02 vira março no Date: a data tem de voltar igual.
  if (`${data.getUTCFullYear()}-${doisDigitos(data.getUTCMonth() + 1)}-${doisDigitos(data.getUTCDate())}` !== `${a}-${mes}-${d}`) return null
  if (data.getTime() > agora.getTime() + 12 * 3_600_000) return null
  return data
}

/** Os estados do PASSO e da SUBTAREFA (os da tarefa vêm do mapa único `rotuloStatusTarefa`). Vocabulário oficial: espera de terceiro = «Aguardando terceiros». */
const ROTULO_DE_PASSO_E_SUBTAREFA: Readonly<Record<string, string>> = {
  PENDENTE: 'Pendente', DISPONIVEL: 'Disponível', AGUARDANDO: 'Aguardando terceiros', AGUARDANDO_EXTERNO: 'Aguardando terceiros', CONCLUIDO: 'Concluída',
  EXECUTADO: 'Executada', AGUARDANDO_APROVACAO: 'Aguardando aprovação', DISPENSADO: 'Dispensada', CANCELADO: 'Cancelada', SUPERSEDIDO: 'Substituída',
  FALHOU: 'Falhou', INVALIDADO: 'Invalidada', BLOQUEADO: 'Bloqueada', ATIVO: 'Ativa',
}
/** O nome claro de cada etapa/subtarefa da Emissão no histórico — nunca a chave interna. */
export const ROTULO_DE_ETAPA: Readonly<Record<string, string>> = {
  solicitar_certidao: 'Solicitar certidão',
  [SUBTAREFA_PEDIDO_ENVIADO]: 'Enviar requerimento ao cartório',
  [SUBTAREFA_CONFIRMACAO]: 'Receber confirmação do pedido',
  [SUBTAREFA_CERTIDAO_RECEBIDA]: 'Receber certidão',
  [SUBTAREFA_CONFERENCIA]: 'Conferir e validar certidão',
}
/** Traduz um estado (da tarefa, do passo ou da subtarefa); o que não conhece volta como está (nunca inventa). */
export const rotuloDeEstado = (v: string | null | undefined): string | null => (v == null ? null : rotuloStatusTarefa(v) ?? ROTULO_DE_PASSO_E_SUBTAREFA[v] ?? v)
