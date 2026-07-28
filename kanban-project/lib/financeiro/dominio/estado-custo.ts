// lib/financeiro/dominio/estado-custo.ts
// ============================================================================
// F4 — Estados de NEGÓCIO do Custo (ObrigacaoEconomica.estadoCusto). Ortogonal ao
// `status` do contrato (RASCUNHO|ATIVO|SUSPENSO|LIQUIDADO|CANCELADO). É um campo de
// 1ª classe: o estado NUNCA é inferido apenas pelo saldo. Receita não usa (null).
//
//   Previsto → Aprovado → Contratado → Executado → Pago → Conciliado
//   (+ Cancelado Parcialmente, Cancelado, Arquivado, quando aplicável)
// ============================================================================
export type EstadoCusto =
  | 'PREVISTO' | 'APROVADO' | 'CONTRATADO' | 'EXECUTADO' | 'PAGO' | 'CONCILIADO'
  | 'CANCELADO_PARCIAL' | 'CANCELADO' | 'ARQUIVADO'

export const ESTADOS_CUSTO: EstadoCusto[] = [
  'PREVISTO', 'APROVADO', 'CONTRATADO', 'EXECUTADO', 'PAGO', 'CONCILIADO',
  'CANCELADO_PARCIAL', 'CANCELADO', 'ARQUIVADO',
]

export const ROTULO_ESTADO_CUSTO: Record<EstadoCusto, string> = {
  PREVISTO: 'Previsto', APROVADO: 'Aprovado', CONTRATADO: 'Contratado', EXECUTADO: 'Executado',
  PAGO: 'Pago', CONCILIADO: 'Conciliado', CANCELADO_PARCIAL: 'Cancelado parcialmente',
  CANCELADO: 'Cancelado', ARQUIVADO: 'Arquivado',
}

/** Estado inicial de um custo recém-criado (obrigação real de pagamento = Contratado).
 *  Provisões (custo Previsto/estimado) entram explicitamente como PREVISTO por quem cria. */
export const ESTADO_CUSTO_INICIAL: EstadoCusto = 'CONTRATADO'

// Máquina de estados — fluxo de negócio para frente + saídas de cancelamento/arquivo.
const TRANSICOES: Record<EstadoCusto, EstadoCusto[]> = {
  PREVISTO: ['APROVADO', 'CONTRATADO', 'CANCELADO', 'ARQUIVADO'],
  APROVADO: ['CONTRATADO', 'CANCELADO', 'ARQUIVADO'],
  CONTRATADO: ['EXECUTADO', 'PAGO', 'CANCELADO_PARCIAL', 'CANCELADO', 'ARQUIVADO'],
  EXECUTADO: ['PAGO', 'CANCELADO_PARCIAL', 'CANCELADO', 'ARQUIVADO'],
  PAGO: ['CONCILIADO', 'CANCELADO_PARCIAL', 'ARQUIVADO'],
  CONCILIADO: ['ARQUIVADO'],
  CANCELADO_PARCIAL: ['PAGO', 'CONCILIADO', 'CANCELADO', 'ARQUIVADO'],
  CANCELADO: ['ARQUIVADO'],
  ARQUIVADO: [], // desarquivar restaura o estado anterior — tratado fora da máquina
}

export function ehEstadoCusto(v: unknown): v is EstadoCusto {
  return typeof v === 'string' && (ESTADOS_CUSTO as string[]).includes(v)
}

export function podeTransicionarEstadoCusto(de: EstadoCusto, para: EstadoCusto): boolean {
  if (de === para) return true
  return TRANSICOES[de]?.includes(para) ?? false
}

/** Aplica uma transição de estado do custo; retorna o novo estado ou erro (não muta). */
export function transicionarEstadoCusto(de: EstadoCusto, para: EstadoCusto): { ok: boolean; estado: EstadoCusto; erro?: string } {
  if (de === para) return { ok: true, estado: de }
  if (!podeTransicionarEstadoCusto(de, para)) return { ok: false, estado: de, erro: `Transição de estado de custo inválida: ${ROTULO_ESTADO_CUSTO[de]} → ${ROTULO_ESTADO_CUSTO[para]}.` }
  return { ok: true, estado: para }
}
