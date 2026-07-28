// lib/financeiro/pagavel/repasse.ts
// ============================================================================
// F5 — REPASSE / REEMBOLSO: vínculo EXPLÍCITO e AUDITÁVEL entre uma obrigação de CUSTO
// (A_PAGAR) e a cobrança/receita do cliente que a recupera. Custo e Receita seguem
// domínios DISTINTOS — este registro é o elo rastreável, NUNCA uma conversão automática.
// Transacional, auditado. Valida as direções (custo=A_PAGAR, cobrança vinculada=A_RECEBER).
// ============================================================================
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'

export type TipoRepasse = 'REPASSE' | 'REEMBOLSO'
export interface EntradaRepasse { tipo: TipoRepasse; valor: number; percentual?: number | null; receitaObrigacaoId?: number | null; cobrancaId?: number | null; pagadorPessoaId?: number | null; motivo?: string | null }

export async function registrarRepasse(custoObrigacaoId: number, input: EntradaRepasse, ctx: { usuarioId?: number | null } = {}) {
  if (input.tipo !== 'REPASSE' && input.tipo !== 'REEMBOLSO') throw new Error('Tipo deve ser REPASSE ou REEMBOLSO.')
  if (!(Number(input.valor) > 0)) throw new Error('Valor do repasse/reembolso deve ser maior que zero.')
  return prisma.$transaction(async (tx) => {
    const custo = await tx.obrigacaoEconomica.findUnique({ where: { id: custoObrigacaoId }, select: { direcao: true } })
    if (!custo) throw new Error('Obrigação de custo inexistente.')
    if (custo.direcao !== 'A_PAGAR') throw new Error('Repasse/reembolso parte de uma obrigação A_PAGAR (custo).')
    if (input.receitaObrigacaoId != null) {
      const rec = await tx.obrigacaoEconomica.findUnique({ where: { id: input.receitaObrigacaoId }, select: { direcao: true } })
      if (!rec) throw new Error('Cobrança (obrigação de receita) vinculada inexistente.')
      if (rec.direcao !== 'A_RECEBER') throw new Error('A obrigação vinculada deve ser A_RECEBER (cobrança ao cliente). Custo NUNCA vira Receita — só se vincula a ela.')
    }
    const r = await tx.repasseCusto.create({ data: {
      custoObrigacaoId, receitaObrigacaoId: input.receitaObrigacaoId ?? null, cobrancaId: input.cobrancaId ?? null,
      tipo: input.tipo, valor: Number(input.valor), percentual: input.percentual ?? null,
      pagadorPessoaId: input.pagadorPessoaId ?? null, motivo: input.motivo?.slice(0, 300) ?? null, criadoPorId: ctx.usuarioId ?? null,
    } })
    await tx.logAuditoria.create({ data: {
      acao: 'REPASSE', entidade: 'ObrigacaoEconomica', entidadeId: custoObrigacaoId,
      descricao: `${input.tipo} de ${Number(input.valor)} vinculado${input.receitaObrigacaoId ? ` à cobrança #${input.receitaObrigacaoId}` : ' (cobrança a definir)'}.${input.motivo ? ` ${input.motivo}` : ''}`.slice(0, 1000),
      detalhes: { tipo: input.tipo, valor: Number(input.valor), receitaObrigacaoId: input.receitaObrigacaoId ?? null } as Prisma.InputJsonValue, usuarioId: ctx.usuarioId ?? null,
    } }).catch(() => {})
    return { id: r.id, custoObrigacaoId, receitaObrigacaoId: r.receitaObrigacaoId, tipo: r.tipo as TipoRepasse, valor: Number(r.valor), status: r.status }
  })
}

export async function cancelarRepasse(id: number, ctx: { usuarioId?: number | null; motivo?: string | null } = {}): Promise<{ ok: boolean }> {
  const r = await prisma.repasseCusto.findUnique({ where: { id } })
  if (!r || r.status === 'CANCELADO') return { ok: false }
  await prisma.repasseCusto.update({ where: { id }, data: { status: 'CANCELADO' } })
  await prisma.logAuditoria.create({ data: { acao: 'REPASSE', entidade: 'ObrigacaoEconomica', entidadeId: r.custoObrigacaoId, descricao: `Repasse/reembolso #${id} cancelado.${ctx.motivo ? ` ${ctx.motivo}` : ''}`.slice(0, 1000), detalhes: { acao: 'CANCELAR', repasseId: id } as Prisma.InputJsonValue, usuarioId: ctx.usuarioId ?? null } }).catch(() => {})
  return { ok: true }
}

export async function repassesDoCusto(custoObrigacaoId: number) {
  const rows = await prisma.repasseCusto.findMany({ where: { custoObrigacaoId }, orderBy: { criadoEm: 'desc' } })
  return rows.map((r) => ({ id: r.id, tipo: r.tipo as TipoRepasse, valor: Number(r.valor), percentual: r.percentual != null ? Number(r.percentual) : null, receitaObrigacaoId: r.receitaObrigacaoId, cobrancaId: r.cobrancaId, pagadorPessoaId: r.pagadorPessoaId, status: r.status, motivo: r.motivo, criadoEm: r.criadoEm.toISOString() }))
}
