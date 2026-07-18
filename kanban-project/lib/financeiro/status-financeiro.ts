// lib/financeiro/status-financeiro.ts
// ============================================================================
// §7 — apresentação PADRONIZADA dos status financeiros JÁ EXISTENTES (sem inventar
// enum). Mapeia estados reais do schema (ReceitaStatus/CustoStatus/StatusParcela/
// StatusContaPagar + flags cancelado/estornado) para rótulo + cor de UI.
// Pura, testável (scripts/financeiro-geral.test.ts).
// ============================================================================

export type StatusUi = 'ABERTO' | 'PENDENTE' | 'PAGO' | 'RECEBIDO' | 'PARCIAL' | 'CANCELADO' | 'ESTORNADO' | 'VENCIDO' | 'AGENDADO' | 'RASCUNHO'

export interface EntradaStatus {
  statusBruto?: string | null // enum do schema (ATIVA, PENDENTE, PAGA, RECEBIDA, CANCELADA, PAGO, VENCIDO, AGENDADO…)
  canceladoEm?: Date | string | null
  estornadoEm?: Date | string | null
  estorno?: boolean | null // este registro é um movimento inverso
  vencida?: boolean | null
  liquidada?: boolean | null // recebida/paga
}

/** Deriva o status de UI canônico a partir dos estados reais (prioridade explícita). */
export function statusUi(e: EntradaStatus): StatusUi {
  if (e.estornadoEm) return 'ESTORNADO'
  if (e.canceladoEm || e.statusBruto === 'CANCELADA' || e.statusBruto === 'CANCELADO') return 'CANCELADO'
  const s = (e.statusBruto ?? '').toUpperCase()
  if (e.liquidada || s === 'RECEBIDA') return 'RECEBIDO'
  if (s === 'PAGA' || s === 'PAGO') return 'PAGO'
  if (s === 'AGENDADO') return 'AGENDADO'
  if (s === 'RASCUNHO') return 'RASCUNHO'
  if (e.vencida || s === 'VENCIDO') return 'VENCIDO'
  if (s === 'PENDENTE') return 'PENDENTE'
  return 'ABERTO'
}

/** Rótulo pt-BR do status de UI. */
export function rotuloStatus(s: StatusUi): string {
  return {
    ABERTO: 'Em aberto', PENDENTE: 'Pendente', PAGO: 'Pago', RECEBIDO: 'Recebido', PARCIAL: 'Parcial',
    CANCELADO: 'Cancelado', ESTORNADO: 'Estornado', VENCIDO: 'Vencido', AGENDADO: 'Agendado', RASCUNHO: 'Rascunho',
  }[s]
}

/** Classe Tailwind de cor por status (usada nos selos). */
export function corStatus(s: StatusUi): string {
  switch (s) {
    case 'RECEBIDO':
    case 'PAGO': return 'bg-green-500/20 text-green-300 border-green-500/30'
    case 'VENCIDO': return 'bg-red-500/20 text-red-300 border-red-500/30'
    case 'CANCELADO': return 'bg-white/10 text-white/50 border-white/20'
    case 'ESTORNADO': return 'bg-purple-500/20 text-purple-300 border-purple-500/30'
    case 'AGENDADO': return 'bg-blue-500/20 text-blue-300 border-blue-500/30'
    case 'PARCIAL': return 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30'
    case 'PENDENTE':
    case 'ABERTO':
    default: return 'bg-amber-500/20 text-amber-300 border-amber-500/30'
  }
}

/** Está ativo para compor TOTAIS? (cancelado nunca; estornado original já é neutralizado pelo inverso). */
export function contaNosTotaisAtivos(s: StatusUi): boolean {
  return s !== 'CANCELADO'
}

/** Pode CANCELAR? (aberto/pendente/agendado; não liquidado, não cancelado, não estornado). */
export function podeCancelar(e: EntradaStatus): boolean {
  const s = statusUi(e)
  return !e.liquidada && s !== 'CANCELADO' && s !== 'ESTORNADO' && s !== 'PAGO' && s !== 'RECEBIDO'
}

/** Deve ESTORNAR em vez de cancelar? (liquidado e ainda não estornado/cancelado). */
export function deveEstornar(e: EntradaStatus): boolean {
  const s = statusUi(e)
  return (!!e.liquidada || s === 'PAGO' || s === 'RECEBIDO') && s !== 'ESTORNADO' && s !== 'CANCELADO'
}
