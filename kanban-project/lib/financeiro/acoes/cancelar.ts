// lib/financeiro/acoes/cancelar.ts
// ============================================================================
// AÇÃO "Cancelar Receita" (Mais Ações · detalhe da Receita, Financeiro V3).
// Marca a Receita como cancelada (cancelada=true + status=CANCELADA + metadados
// §10), MAS NÃO apaga cobranças, pagamentos nem ledger — histórico preservado.
// BLOQUEIA (409) se houver pagamento CONFIRMADO: exige estorno antes.
// ============================================================================
import { prisma } from '@/lib/prisma'
import { carregarContextoReceita, registrarEventoReceita } from './receita-contexto'
import { AcaoReceitaError } from './recibo'

export interface CancelarResultado {
  receitaId: number
  status: string
  jaCancelada: boolean
}

export async function cancelarReceita(
  ref: string,
  body: { motivo?: string | null },
  opts: { usuarioId?: number | null } = {},
): Promise<CancelarResultado> {
  const ctx = await carregarContextoReceita(ref)
  if (!ctx) throw new AcaoReceitaError('Receita não encontrada.', 404)
  if (ctx.receitaId == null || !ctx.receita) throw new AcaoReceitaError('Receita legada de origem não encontrada; nada a cancelar.', 422)

  if (ctx.receita.cancelada || ctx.receita.status === 'CANCELADA') {
    return { receitaId: ctx.receitaId, status: 'CANCELADA', jaCancelada: true }
  }

  // Guarda §11: pagamento confirmado precisa ser ESTORNADO antes do cancelamento.
  if (ctx.temPagamentoConfirmado) {
    throw new AcaoReceitaError(
      `Receita possui ${ctx.pagamentosConfirmados.length} pagamento(s) confirmado(s). Estorne o(s) pagamento(s) antes de cancelar.`,
      409,
    )
  }

  const motivo = body.motivo?.trim() || null

  await prisma.receita.update({
    where: { id: ctx.receitaId },
    data: {
      cancelada: true,
      status: 'CANCELADA',
      canceladoEm: new Date(),
      canceladoMotivo: motivo?.slice(0, 500) ?? null,
      canceladoPorId: opts.usuarioId ?? null,
    },
  })

  await registrarEventoReceita({
    receitaId: ctx.receitaId,
    tipo: 'CANCELAMENTO',
    descricao: `Receita ${ctx.codigo ?? ctx.receitaId} cancelada.${motivo ? ` Motivo: ${motivo}` : ''} Cobranças/pagamentos/ledger preservados.`,
    usuarioId: opts.usuarioId ?? null,
    dados: { acao: 'CANCELAR', obrigacaoId: ctx.obrigacaoId, motivo },
  })

  return { receitaId: ctx.receitaId, status: 'CANCELADA', jaCancelada: false }
}
