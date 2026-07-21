// src/components/financeiro/receita-modal/tipos.ts
// ============================================================================
// Contrato de dados do modal financeiro central — espelha EXATAMENTE o payload
// de GET /api/financeiro/receitas/[id]/detalhe. Nenhuma regra de negócio aqui:
// o motor decide, esta camada apenas apresenta.
// ============================================================================

import type { LancamentoView, StatusLancamento } from '@/lib/financeiro/apresentacao-lancamento'

export interface Composicao {
  linhas: Array<{ rotulo: string; detalhe?: string; valor: number }>
  total: number
  moeda: string
  requerentes?: number
  regra?: string
}

export interface EventoReceita {
  id: number
  tipo: string
  descricao: string
  valor?: number | string | null
  /** Campos já gravados pelo EventoFinanceiro — lidos, nunca alterados. */
  cambio?: number | string | null
  valorBrl?: number | string | null
  dados?: unknown
  createdAt: string
  usuario?: { id: number; nome: string } | null
}

export interface Detalhe {
  receita: LancamentoView & {
    observacoes?: string | null
    createdAt?: string
    updatedAt?: string
    valorUnitario?: number | string | null
    quantidade?: number | string | null
    composicao: Composicao | null
    eventos?: EventoReceita[]
  }
  requerentesConsiderados: Array<{ id: number; nome: string; statusFamiliar?: string | null; percentual: number }>
  origem: {
    processo: { id: number; codigo: string | null; nome: string; pais: string; tipo: string | null } | null
    phaseKey: string | null
    faseLabel: string | null
    servico: string | null
    documento: { id: number; tipo: string | null } | null
    configuracaoFinanceira: { id: number; nome: string; moedaPadrao: string } | null
    tabelaPrecos: {
      id: number
      modoCalculo: string
      natureza: string | null
      vigenciaInicio: string | null
      vigenciaFim: string | null
      arquivado: boolean
    } | null
    regraFinanceira: { descricao: string; ruleKind: string; ruleSource: string; ruleId: number | null } | null
    eventoOperacional: string | null
    criadoEm: string
    atualizadoEm: string
    dataReferencia: string | null
    tecnico: Record<string, unknown>
  }
  supressao: { ativa: boolean; motivo: string; suprimidoEm: string; usuarioId: number | null } | null
  origemAtiva: boolean
  cancelamento: { em: string; motivo: string | null; por: string | null } | null
  estorno: { em: string; motivo: string | null } | null
  acoes: {
    podeCancelar: boolean
    exigeSupressao: boolean
    podeEstornar: boolean
    podeEditarParcelas: boolean
    podeRegistrarRecebimento: boolean
    podeRevogarSupressao: boolean
    motivoBloqueioCancelamento: string | null
    motivoBloqueioParcelas: string | null
  }
}

/** Tom de cor do status — apresentação apenas; o status vem da fonte única. */
export const STATUS_TOM: Record<StatusLancamento, string> = {
  RECEBIDO: '#15803d',
  VENCIDO: '#b91c1c',
  CANCELADO: '#64748b',
  ESTORNADO: '#64748b',
  PARCIALMENTE_RECEBIDO: '#0369a1',
  A_VENCER: '#475569',
  SEM_VENCIMENTO: '#b45309',
  PREVISTO: '#475569',
}

export type AbaId = 'geral' | 'parcelas' | 'recebimentos' | 'historico' | 'tecnico'

export const ABAS: Array<{ id: AbaId; label: string }> = [
  { id: 'geral', label: 'Visão geral' },
  { id: 'parcelas', label: 'Parcelas' },
  { id: 'recebimentos', label: 'Recebimentos' },
  { id: 'historico', label: 'Histórico' },
  { id: 'tecnico', label: 'Informações técnicas' },
]

export function cabecalhosAuth(): HeadersInit {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${typeof window !== 'undefined' ? localStorage.getItem('authToken') || '' : ''}`,
  }
}

/** Iniciais para o avatar do requerente. */
export function iniciais(nome: string): string {
  const partes = nome.trim().split(/\s+/).filter(Boolean)
  if (partes.length === 0) return '—'
  if (partes.length === 1) return partes[0].slice(0, 2).toUpperCase()
  return (partes[0][0] + partes[partes.length - 1][0]).toUpperCase()
}

/** Data + hora curtas para as timelines. */
export function fmtDataHora(iso?: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return '—'
  return `${d.toLocaleDateString('pt-BR')} · ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`
}
