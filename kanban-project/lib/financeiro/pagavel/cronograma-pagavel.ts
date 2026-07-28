// lib/financeiro/pagavel/cronograma-pagavel.ts
// ============================================================================
// F5 — Componente OFICIAL de Contas a Pagar: CRONOGRAMA de vencimentos (ParcelaPagavel).
// Reutilizável por QUALQUER ObrigacaoEconomica A_PAGAR. Guarda só o PLANO
// (vencimento + valor planejado); o SALDO permanece exclusivamente no Ledger. O status
// de pagamento de cada parcela é DERIVADO (recebido acumulado do Ledger + vencimento) —
// nunca armazenado/duplicado. Mutações transacionais, idempotentes e auditadas.
// ============================================================================
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'

const cent = (v: number) => Math.round((Number(v) || 0) * 100) / 100

export interface ParcelaPlano { numero?: number; vencimento: string | Date; valor: number }
export type StatusParcelaPagavel = 'PENDENTE' | 'PARCIAL' | 'PAGA' | 'VENCIDA' | 'CANCELADA'
export interface ParcelaPagavelView { id: number; numero: number; vencimento: string; valor: number; moeda: string; status: StatusParcelaPagavel }

/** Define o cronograma de uma obrigação A_PAGAR. Idempotente (não recria se já existe).
 *  Valida: obrigação é A_PAGAR e a SOMA das parcelas = valorContratado (invariante do plano). */
export async function definirCronogramaPagavel(
  obrigacaoId: number, parcelas: ParcelaPlano[], ctx: { usuarioId?: number | null } = {},
): Promise<{ obrigacaoId: number; criadas: number; jaExistia: boolean }> {
  return prisma.$transaction(async (tx) => {
    const obr = await tx.obrigacaoEconomica.findUnique({ where: { id: obrigacaoId }, select: { direcao: true, valorContratado: true, moedaContratual: true } })
    if (!obr) throw new Error('Obrigação inexistente.')
    if (obr.direcao !== 'A_PAGAR') throw new Error('Cronograma de pagáveis só se aplica a obrigações A_PAGAR.')
    if (await tx.parcelaPagavel.count({ where: { obrigacaoId } }) > 0) return { obrigacaoId, criadas: 0, jaExistia: true }
    if (!parcelas.length) throw new Error('Informe ao menos uma parcela.')
    const soma = cent(parcelas.reduce((s, p) => s + Number(p.valor), 0))
    if (Math.abs(soma - Number(obr.valorContratado)) > 0.01) throw new Error(`Soma das parcelas (${soma}) ≠ valor da obrigação (${Number(obr.valorContratado)}). O Ledger é a fonte do saldo; o cronograma só distribui o valor.`)
    await tx.parcelaPagavel.createMany({ data: parcelas.map((p, i) => ({ obrigacaoId, numero: p.numero ?? i + 1, vencimento: new Date(p.vencimento), valor: cent(Number(p.valor)), moeda: obr.moedaContratual, criadoPorId: ctx.usuarioId ?? null })) })
    await tx.logAuditoria.create({ data: { acao: 'CRONOGRAMA_PAGAVEL', entidade: 'ObrigacaoEconomica', entidadeId: obrigacaoId, descricao: `Cronograma de pagamento definido: ${parcelas.length} parcela(s), soma ${soma}.`.slice(0, 1000), detalhes: { parcelas: parcelas.length, soma } as Prisma.InputJsonValue, usuarioId: ctx.usuarioId ?? null } }).catch(() => {})
    return { obrigacaoId, criadas: parcelas.length, jaExistia: false }
  })
}

/** Cancela UMA parcela do cronograma (só o plano; o Ledger/saldo não é tocado). Auditado. */
export async function cancelarParcelaPagavel(obrigacaoId: number, numero: number, ctx: { usuarioId?: number | null; motivo?: string | null } = {}): Promise<{ ok: boolean }> {
  const p = await prisma.parcelaPagavel.findUnique({ where: { obrigacaoId_numero: { obrigacaoId, numero } } })
  if (!p || p.canceladaEm) return { ok: false }
  await prisma.parcelaPagavel.update({ where: { id: p.id }, data: { canceladaEm: new Date() } })
  await prisma.logAuditoria.create({ data: { acao: 'CRONOGRAMA_PAGAVEL', entidade: 'ObrigacaoEconomica', entidadeId: obrigacaoId, descricao: `Parcela ${numero} do cronograma cancelada.${ctx.motivo ? ` ${ctx.motivo}` : ''}`.slice(0, 1000), detalhes: { parcela: numero, acao: 'CANCELAR_PARCELA' } as Prisma.InputJsonValue, usuarioId: ctx.usuarioId ?? null } }).catch(() => {})
  return { ok: true }
}

/** Lê o cronograma com STATUS DERIVADO do Ledger (recebido acumulado) + vencimento.
 *  Sem armazenar/duplicar saldo: PAGA/PARCIAL vêm do recebido; VENCIDA da data. */
export async function parcelasPagaveisComStatus(obrigacaoId: number): Promise<ParcelaPagavelView[]> {
  const [parcelas, proj] = await Promise.all([
    prisma.parcelaPagavel.findMany({ where: { obrigacaoId }, orderBy: { numero: 'asc' } }),
    prisma.saldoProjecao.findUnique({ where: { obrigacaoId }, select: { recebidoBruto: true } }),
  ])
  const pago = cent(Number(proj?.recebidoBruto ?? 0)) // "recebido" do pagável = quanto já foi pago (Ledger = SSOT)
  const hoje = new Date(); hoje.setHours(0, 0, 0, 0)
  let acumulado = 0
  return parcelas.map((p) => {
    const valor = cent(Number(p.valor))
    const antes = acumulado
    if (!p.canceladaEm) acumulado += valor // parcela cancelada não consome cobertura
    let status: StatusParcelaPagavel
    if (p.canceladaEm) status = 'CANCELADA'
    else if (pago >= antes + valor - 0.005) status = 'PAGA'
    else if (pago > antes + 0.005) status = 'PARCIAL'
    else if (p.vencimento < hoje) status = 'VENCIDA'
    else status = 'PENDENTE'
    return { id: p.id, numero: p.numero, vencimento: p.vencimento.toISOString(), valor, moeda: String(p.moeda), status }
  })
}
