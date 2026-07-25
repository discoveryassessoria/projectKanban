// lib/financeiro/acoes/arquivar.ts
// ============================================================================
// AÇÃO "Arquivar Receita" (Mais Ações · detalhe da Receita, Financeiro V3).
// Marca Receita.arquivadaEm (coluna aditiva/reversível) SEM alterar saldos,
// cobranças, pagamentos, parcelas ou ledger. Arquivar ≠ cancelar: é apenas uma
// organização de visão. Suporta desarquivar (arquivar=false).
// ============================================================================
import { prisma } from '@/lib/prisma'
import { carregarContextoReceita, registrarEventoReceita } from './receita-contexto'
import { AcaoReceitaError } from './recibo'

export interface ArquivarResultado {
  receitaId: number
  arquivada: boolean
  arquivadaEm: string | null
}

export async function arquivarReceita(
  ref: string,
  body: { arquivar?: boolean; observacao?: string | null },
  opts: { usuarioId?: number | null } = {},
): Promise<ArquivarResultado> {
  const ctx = await carregarContextoReceita(ref)
  if (!ctx) throw new AcaoReceitaError('Receita não encontrada.', 404)
  if (ctx.receitaId == null || !ctx.receita) throw new AcaoReceitaError('Receita legada de origem não encontrada; nada a arquivar.', 422)

  const arquivar = body.arquivar !== false // default: arquivar
  const jaArquivada = ctx.receita.arquivadaEm != null
  if (arquivar === jaArquivada) {
    return { receitaId: ctx.receitaId, arquivada: jaArquivada, arquivadaEm: ctx.receita.arquivadaEm?.toISOString() ?? null }
  }

  const arquivadaEm = arquivar ? new Date() : null
  await prisma.receita.update({ where: { id: ctx.receitaId }, data: { arquivadaEm } })

  await registrarEventoReceita({
    receitaId: ctx.receitaId,
    tipo: 'EDICAO',
    descricao: `Receita ${ctx.codigo ?? ctx.receitaId} ${arquivar ? 'arquivada' : 'desarquivada'}.${body.observacao?.trim() ? ` Obs.: ${body.observacao.trim()}` : ''} Saldos inalterados.`,
    usuarioId: opts.usuarioId ?? null,
    dados: { acao: arquivar ? 'ARQUIVAR' : 'DESARQUIVAR', obrigacaoId: ctx.obrigacaoId },
  })

  return { receitaId: ctx.receitaId, arquivada: arquivar, arquivadaEm: arquivadaEm?.toISOString() ?? null }
}
