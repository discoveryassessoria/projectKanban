// lib/financeiro/acoes/receita-contexto.ts
// ============================================================================
// CONTEXTO das "Mais Ações" do detalhe da Receita (Financeiro V3).
// Núcleo puro de I/O reutilizado pelos serviços de ação (recibo/renegociar/
// cancelar/arquivar). Resolve a ref (obrigacaoId) → Obrigação + Receita legada +
// pagamentos CONFIRMADOS, e centraliza a auditoria via EventoFinanceiro.
// Não altera saldos — só lê o estado e registra eventos.
// ============================================================================
import { prisma } from '@/lib/prisma'
import { resolverId } from '@/lib/financeiro/leitura/receita-detalhe'
import type { TipoEventoFinanceiro } from '@prisma/client'

export interface PagamentoConfirmado {
  id: number
  valor: number
  moeda: string
  data: Date
}

export interface ReceitaBasica {
  id: number
  codigo: string
  descricao: string
  processoId: number
  cancelada: boolean
  status: string
  arquivadaEm: Date | null
}

export interface ContextoReceita {
  obrigacaoId: number
  receitaId: number | null
  processoId: number | null
  moeda: string
  codigo: string | null
  descricao: string | null
  receita: ReceitaBasica | null
  pagamentosConfirmados: PagamentoConfirmado[]
  temPagamentoConfirmado: boolean
  totalConfirmado: number
}

const cent = (v: number) => Math.round((Number(v) || 0) * 100) / 100

// Pagamento CONFIRMADO = ocorrência de pagamento efetivada (status PROCESSADA),
// mesma definição que a leitura da Receita usa para exibir "Confirmado".
const TIPOS_PAGAMENTO = ['PAGAMENTO', 'PAGAMENTO_PARCIAL'] as const

export async function carregarContextoReceita(ref: string): Promise<ContextoReceita | null> {
  const obrigacaoId = await resolverId(ref)
  if (!obrigacaoId) return null

  const obr = await prisma.obrigacaoEconomica.findUnique({
    where: { id: obrigacaoId },
    select: {
      id: true, origemTipo: true, origemId: true, processoId: true,
      moedaContratual: true, codigoOperacional: true, observacoes: true,
      ocorrencias: {
        where: { tipo: { in: [...TIPOS_PAGAMENTO] }, status: 'PROCESSADA' },
        select: { id: true, valor: true, moeda: true, data: true },
        orderBy: { data: 'asc' },
      },
    },
  })
  if (!obr) return null

  const receitaId = obr.origemTipo === 'Receita' ? (obr.origemId ?? null) : null
  // arquivadaEm é aditivo — resiliente durante rollout (null se a coluna ainda não existe).
  const receita = receitaId
    ? await prisma.receita
        .findUnique({
          where: { id: receitaId },
          select: { id: true, codigo: true, descricao: true, processoId: true, cancelada: true, status: true, arquivadaEm: true },
        })
        .catch(() => null)
    : null

  const pagamentosConfirmados: PagamentoConfirmado[] = obr.ocorrencias.map((o) => ({
    id: o.id, valor: cent(Number(o.valor)), moeda: String(o.moeda), data: o.data,
  }))
  const totalConfirmado = cent(pagamentosConfirmados.reduce((s, p) => s + p.valor, 0))

  return {
    obrigacaoId: obr.id,
    receitaId,
    processoId: obr.processoId ?? receita?.processoId ?? null,
    moeda: String(obr.moedaContratual),
    codigo: obr.codigoOperacional,
    descricao: receita?.descricao ?? obr.observacoes ?? null,
    receita: receita
      ? {
          id: receita.id, codigo: receita.codigo, descricao: receita.descricao, processoId: receita.processoId,
          cancelada: receita.cancelada, status: String(receita.status), arquivadaEm: receita.arquivadaEm ?? null,
        }
      : null,
    pagamentosConfirmados,
    temPagamentoConfirmado: pagamentosConfirmados.length > 0,
    totalConfirmado,
  }
}

// Auditoria canônica das ações — grava um EventoFinanceiro vinculado à Receita.
// No-op seguro (retorna null) quando não há Receita legada de origem.
export async function registrarEventoReceita(params: {
  receitaId: number | null
  tipo: TipoEventoFinanceiro
  descricao: string
  valor?: number | null
  usuarioId?: number | null
  dados?: Record<string, unknown> | null
}) {
  if (params.receitaId == null) return null
  return prisma.eventoFinanceiro
    .create({
      data: {
        receitaId: params.receitaId,
        tipo: params.tipo,
        descricao: params.descricao.slice(0, 500),
        valor: params.valor ?? null,
        usuarioId: params.usuarioId ?? null,
        dados: (params.dados ?? undefined) as never,
      },
    })
    .catch(() => null)
}
