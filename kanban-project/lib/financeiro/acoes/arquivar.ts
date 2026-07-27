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
  receitaId: number | null
  obrigacaoId: number
  arquivada: boolean
  arquivadaEm: string | null
}

export async function arquivarReceita(
  ref: string,
  body: { arquivar?: boolean; observacao?: string | null },
  opts: { usuarioId?: number | null } = {},
): Promise<ArquivarResultado> {
  const ctx = await carregarContextoReceita(ref)
  if (!ctx) throw new AcaoReceitaError('Registro não encontrado.', 404)

  const arquivar = body.arquivar !== false // default: arquivar
  const obs = body.observacao?.trim()

  // ── CUSTO (sem Receita de origem): arquiva a própria obrigação (ObrigacaoEconomica
  // .arquivadaEm, mesma coluna do soft-delete de custo). Arquivar ≠ cancelar; suporta
  // desarquivar. Antes lançava erro "Receita legada não encontrada" — no-op p/ custo.
  if (ctx.receitaId == null || !ctx.receita) {
    const obr = await prisma.obrigacaoEconomica.findUnique({ where: { id: ctx.obrigacaoId }, select: { arquivadaEm: true } })
    if (!obr) throw new AcaoReceitaError('Custo não encontrado.', 404)
    const jaArq = obr.arquivadaEm != null
    if (arquivar === jaArq) return { receitaId: null, obrigacaoId: ctx.obrigacaoId, arquivada: jaArq, arquivadaEm: obr.arquivadaEm?.toISOString() ?? null }
    const arquivadaEm = arquivar ? new Date() : null
    await prisma.obrigacaoEconomica.update({ where: { id: ctx.obrigacaoId }, data: { arquivadaEm } })
    await prisma.logAuditoria.create({ data: {
      acao: arquivar ? 'ARQUIVAR' : 'DESARQUIVAR', entidade: 'ObrigacaoEconomica', entidadeId: ctx.obrigacaoId,
      descricao: `Custo ${ctx.codigo ?? ctx.obrigacaoId} ${arquivar ? 'arquivado' : 'desarquivado'}.${obs ? ` Obs.: ${obs}` : ''} Saldos inalterados.`.slice(0, 1000),
      detalhes: { acao: arquivar ? 'ARQUIVAR' : 'DESARQUIVAR', natureza: 'CUSTO' } as never, usuarioId: opts.usuarioId ?? null,
    } }).catch(() => {})
    return { receitaId: null, obrigacaoId: ctx.obrigacaoId, arquivada: arquivar, arquivadaEm: arquivadaEm?.toISOString() ?? null }
  }

  // ── RECEITA: comportamento existente (Receita.arquivadaEm) ──
  const jaArquivada = ctx.receita.arquivadaEm != null
  if (arquivar === jaArquivada) {
    return { receitaId: ctx.receitaId, obrigacaoId: ctx.obrigacaoId, arquivada: jaArquivada, arquivadaEm: ctx.receita.arquivadaEm?.toISOString() ?? null }
  }

  const arquivadaEm = arquivar ? new Date() : null
  await prisma.receita.update({ where: { id: ctx.receitaId }, data: { arquivadaEm } })

  await registrarEventoReceita({
    receitaId: ctx.receitaId,
    tipo: 'EDICAO',
    descricao: `Receita ${ctx.codigo ?? ctx.receitaId} ${arquivar ? 'arquivada' : 'desarquivada'}.${obs ? ` Obs.: ${obs}` : ''} Saldos inalterados.`,
    usuarioId: opts.usuarioId ?? null,
    dados: { acao: arquivar ? 'ARQUIVAR' : 'DESARQUIVAR', obrigacaoId: ctx.obrigacaoId },
  })

  return { receitaId: ctx.receitaId, obrigacaoId: ctx.obrigacaoId, arquivada: arquivar, arquivadaEm: arquivadaEm?.toISOString() ?? null }
}
