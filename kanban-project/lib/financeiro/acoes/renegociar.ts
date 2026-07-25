// lib/financeiro/acoes/renegociar.ts
// ============================================================================
// AÇÃO "Renegociar" (Mais Ações · detalhe da Receita, Financeiro V3).
// Atua SOMENTE sobre cobranças ABERTAS/PARCIAIS (com saldo em aberto). NUNCA
// sobre pagamentos confirmados nem cobranças QUITADA/CANCELADA/RENEGOCIADA.
// Marca as elegíveis como RENEGOCIADA e (opcionalmente) empurra o vencimento;
// preserva histórico — não apaga cobrança, parcela, pagamento nem ledger.
// ============================================================================
import { prisma } from '@/lib/prisma'
import { carregarContextoReceita, registrarEventoReceita } from './receita-contexto'
import { AcaoReceitaError } from './recibo'

const STATUS_ELEGIVEL = ['ABERTA', 'PARCIAL']

export interface RenegociarResultado {
  renegociadas: number
  cobrancaIds: number[]
  novaData: string | null
}

export async function renegociar(
  ref: string,
  body: { novaData?: string | Date | null; observacao?: string | null },
  opts: { usuarioId?: number | null } = {},
): Promise<RenegociarResultado> {
  const ctx = await carregarContextoReceita(ref)
  if (!ctx) throw new AcaoReceitaError('Receita não encontrada.', 404)
  if (ctx.receitaId == null) throw new AcaoReceitaError('Receita legada de origem não encontrada; nada a renegociar.', 422)

  const novaData = body.novaData ? new Date(body.novaData) : null
  if (body.novaData && Number.isNaN(novaData!.getTime())) throw new AcaoReceitaError('novaData inválida.', 400)

  // Somente cobranças em aberto/parcial (com saldo) — pagamentos confirmados intocados.
  const elegiveis = await prisma.cobranca.findMany({
    where: { receitaId: ctx.receitaId, status: { in: STATUS_ELEGIVEL } },
    select: { id: true, status: true, valorTotal: true, observacoes: true },
  })

  if (!elegiveis.length) throw new AcaoReceitaError('Nenhuma cobrança em aberto elegível para renegociação.', 422)

  const cobrancaIds = elegiveis.map((c) => c.id)
  const nota = body.observacao?.trim()
    ? `Renegociada em ${new Date().toISOString().slice(0, 10)}: ${body.observacao.trim()}`
    : `Renegociada em ${new Date().toISOString().slice(0, 10)}`

  await prisma.$transaction(async (tx) => {
    for (const c of elegiveis) {
      const obs = [c.observacoes?.trim(), nota].filter(Boolean).join(' | ').slice(0, 2000)
      await tx.cobranca.update({
        where: { id: c.id },
        data: { status: 'RENEGOCIADA', observacoes: obs, ...(novaData ? { atualizadoEm: new Date() } : {}) },
      })
    }
  })

  await registrarEventoReceita({
    receitaId: ctx.receitaId,
    tipo: 'EDICAO',
    descricao: `Renegociação de ${elegiveis.length} cobrança(s) em aberto${novaData ? `, novo vencimento ${novaData.toISOString().slice(0, 10)}` : ''}.${body.observacao?.trim() ? ` Obs.: ${body.observacao.trim()}` : ''}`,
    usuarioId: opts.usuarioId ?? null,
    dados: { acao: 'RENEGOCIAR', obrigacaoId: ctx.obrigacaoId, cobrancaIds, novaData: novaData?.toISOString() ?? null, observacao: body.observacao ?? null },
  })

  return { renegociadas: elegiveis.length, cobrancaIds, novaData: novaData?.toISOString() ?? null }
}
