// lib/financeiro/leitura/consultas.ts
// ============================================================================
// CONSULTAS AGREGADAS do Motor Financeiro V3 (leitura para as telas definitivas).
// Tudo derivado do Ledger/projeções — o legado não é fonte aqui. Ver spec §Projeções.
// ============================================================================
import { prisma } from '@/lib/prisma'
import { projetar, type EntryProjecao } from '../ledger/projecao'

const cent = (v: number) => Math.round((Number(v) || 0) * 100) / 100

export interface ObrigacaoLista {
  obrigacaoId: number
  codigoOperacional: string | null
  descricao: string | null
  natureza: string
  direcao: string
  status: string
  processoId: number | null
  moeda: string
  valorContratado: number
  saldo: number
  recebido: number
  vencimento: string | null
  origemTipo: string | null
  temAbertura: boolean
}

/** Lista obrigações com saldo (projeção). Filtros opcionais. */
export async function listarObrigacoes(f?: { processoId?: number; status?: string; natureza?: string; origemTipo?: string }): Promise<ObrigacaoLista[]> {
  const obrs = await prisma.obrigacaoEconomica.findMany({
    where: {
      ...(f?.processoId ? { processoId: f.processoId } : {}),
      // Sem status explícito, exclui CANCELADO (segue no Extrato/Timeline p/ histórico).
      ...(f?.status ? { status: f.status } : { status: { not: 'CANCELADO' } }),
      ...(f?.natureza ? { natureza: f.natureza } : {}),
      ...(f?.origemTipo ? { origemTipo: f.origemTipo } : {}),
    },
    orderBy: { id: 'desc' },
    take: 500,
  })
  const ids = obrs.map((o) => o.id)
  const projs = ids.length ? await prisma.saldoProjecao.findMany({ where: { obrigacaoId: { in: ids } } }) : []
  const projPor = new Map(projs.map((p) => [p.obrigacaoId, p]))
  const aberturas = ids.length ? await prisma.ledgerOpeningBalance.findMany({ where: { obrigacaoId: { in: ids }, revertidoEm: null }, select: { obrigacaoId: true } }) : []
  const comAbertura = new Set(aberturas.map((a) => a.obrigacaoId))
  return obrs.map((o) => {
    const p = projPor.get(o.id)
    return {
      obrigacaoId: o.id, codigoOperacional: o.codigoOperacional, descricao: o.observacoes ?? null, natureza: o.natureza, direcao: o.direcao,
      status: o.status, processoId: o.processoId, moeda: String(o.moedaContratual),
      valorContratado: Number(o.valorContratado), saldo: p ? Number(p.saldo) : Number(o.valorContratado),
      recebido: p ? Number(p.recebidoBruto) : 0,
      vencimento: o.vencimento ? o.vencimento.toISOString() : null, origemTipo: o.origemTipo ?? null,
      temAbertura: comAbertura.has(o.id),
    }
  })
}

/** Resumo financeiro (visão geral): totais derivados das projeções. */
export async function resumoFinanceiro() {
  const obrs = await listarObrigacoes()
  const aReceber = obrs.filter((o) => o.direcao === 'A_RECEBER')
  const totalContratado = cent(aReceber.reduce((s, o) => s + o.valorContratado, 0))
  const totalSaldo = cent(aReceber.reduce((s, o) => s + o.saldo, 0))
  const totalRecebido = cent(aReceber.reduce((s, o) => s + o.recebido, 0))
  const porStatus: Record<string, number> = {}
  const porNatureza: Record<string, number> = {}
  for (const o of obrs) { porStatus[o.status] = (porStatus[o.status] ?? 0) + 1; porNatureza[o.natureza] = (porNatureza[o.natureza] ?? 0) + 1 }
  const divergencias = (await listarDivergencias()).length
  const conciliacao = await prisma.lancamentoBancario.groupBy({ by: ['status'], _count: true }).catch(() => [])
  return {
    obrigacoes: obrs.length,
    aReceber: { quantidade: aReceber.length, contratado: totalContratado, saldo: totalSaldo, recebido: totalRecebido },
    porStatus, porNatureza,
    divergencias,
    conciliacao: Object.fromEntries((conciliacao as { status: string; _count: number }[]).map((c) => [c.status, c._count])),
  }
}

export interface Divergencia {
  obrigacaoId: number
  codigoOperacional: string | null
  saldoProjecao: number
  saldoReplay: number
  delta: number
}

/** Divergências projeção (cache) × replay (Ledger) — deve ser sempre vazio. */
export async function listarDivergencias(): Promise<Divergencia[]> {
  const obrs = await prisma.obrigacaoEconomica.findMany({
    include: { ledger: { include: { entries: { select: { contaContabil: true, direcao: true, valorContabil: true, sequencia: true } } } } },
    take: 1000,
  })
  const projs = await prisma.saldoProjecao.findMany()
  const projPor = new Map(projs.map((p) => [p.obrigacaoId, Number(p.saldo)]))
  const out: Divergencia[] = []
  for (const o of obrs) {
    const entries: EntryProjecao[] = (o.ledger?.entries ?? []).map((e) => ({ conta: e.contaContabil, direcao: e.direcao as 'DEBITO' | 'CREDITO', valor: Number(e.valorContabil), sequencia: e.sequencia }))
    const replay = projetar(entries).saldo
    const proj = projPor.get(o.id)
    if (proj != null && Math.abs(proj - replay) > 0.005) {
      out.push({ obrigacaoId: o.id, codigoOperacional: o.codigoOperacional, saldoProjecao: proj, saldoReplay: replay, delta: cent(proj - replay) })
    }
  }
  return out
}

/** Auditoria financeira (LogAuditoria da data de corte + entidades V3). */
export async function listarAuditoria(limite = 100) {
  const logs = await prisma.logAuditoria.findMany({
    where: { entidade: { in: ['LedgerOpeningBalance', 'ObrigacaoEconomica', 'OcorrenciaFinanceira', 'LancamentoBancario'] } },
    orderBy: { criadoEm: 'desc' }, take: limite,
    select: { id: true, acao: true, entidade: true, entidadeId: true, descricao: true, detalhes: true, usuarioId: true, criadoEm: true },
  })
  return logs.map((l) => ({ ...l, criadoEm: l.criadoEm.toISOString() }))
}
