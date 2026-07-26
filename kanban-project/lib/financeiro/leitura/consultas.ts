// lib/financeiro/leitura/consultas.ts
// ============================================================================
// CONSULTAS AGREGADAS do Motor Financeiro V3 (leitura para as telas definitivas).
// Tudo derivado do Ledger/projeções — o legado não é fonte aqui. Ver spec §Projeções.
// ============================================================================
import { prisma } from '@/lib/prisma'
import { projetar, type EntryProjecao } from '../ledger/projecao'
import { computeCambioAging, cotacoesVivas } from './cambio-aging'

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
  criadoEm: string | null
  responsavel: string | null
  requerente: string | null
  temAbertura: boolean
  // ── câmbio-aware (FONTE ÚNICA: computeCambioAging — Ledger + fx congelado). Elimina
  // o `fx=5.5` dos consumidores (Custos/Extrato/Timeline/Visão Geral). ──
  contratadoBrl: number
  /** montante NÃO convertido (moeda de origem). > 0 = os campos *Brl não o representam. */
  naoConvertido: number
  recebidoBrl: number
  saldoBrl: number
  aVencerBrl: number
  vencidoBrl: number
  cotacao: number | null
  statusAging: string
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
    include: { distribuicoes: { orderBy: { versao: 'desc' }, take: 1, include: { participacoes: true } } },
  })
  const ids = obrs.map((o) => o.id)
  const projs = ids.length ? await prisma.saldoProjecao.findMany({ where: { obrigacaoId: { in: ids } } }) : []
  const projPor = new Map(projs.map((p) => [p.obrigacaoId, p]))
  // Rótulo vindo do Cadastro Mestre (Gerenciamento), não da observação/legado.
  const itemIds = obrs.map((o) => o.itemCatalogoId).filter((v): v is number => v != null)
  const itens = itemIds.length ? await prisma.itemCatalogo.findMany({ where: { id: { in: itemIds } }, select: { id: true, name: true } }).catch(() => []) : []
  const itemPor = new Map(itens.map((i) => [i.id, i.name]))
  const aberturas = ids.length ? await prisma.ledgerOpeningBalance.findMany({ where: { obrigacaoId: { in: ids }, revertidoEm: null }, select: { obrigacaoId: true } }) : []
  const comAbertura = new Set(aberturas.map((a) => a.obrigacaoId))
  // Responsável (quem lançou) — resolve nomes em lote.
  const userIds = [...new Set(obrs.map((o) => o.criadoPorId).filter((v): v is number => v != null))]
  const usuarios = userIds.length ? await prisma.usuario.findMany({ where: { id: { in: userIds } }, select: { id: true, nome: true } }).catch(() => []) : []
  const userPor = new Map(usuarios.map((u) => [u.id, u.nome]))
  // Requerente principal (1ª participação incluída da distribuição vigente) — nomes em lote.
  const primPart = new Map<number, number>()
  const pessoaIdSet = new Set<number>()
  for (const ob of obrs) {
    const dist = ob.distribuicoes[0]
    const part = dist?.participacoes.find((p) => p.incluido) ?? dist?.participacoes[0]
    if (part?.pessoaId != null) { primPart.set(ob.id, part.pessoaId); pessoaIdSet.add(part.pessoaId) }
  }
  const pessoasReq = pessoaIdSet.size ? await prisma.pessoa.findMany({ where: { id: { in: [...pessoaIdSet] } }, select: { id: true, nome: true, sobrenome: true } }).catch(() => []) : []
  const pessoaNomeReq = new Map(pessoasReq.map((p) => [p.id, [p.nome, p.sobrenome].filter(Boolean).join(' ')]))
  // ── SSOT de câmbio/aging: fx congelado da Receita de origem + parcelas + cotações vivas ──
  const recIds = [...new Set(obrs.filter((o) => o.origemTipo === 'Receita' && o.origemId != null).map((o) => o.origemId as number))]
  const recsFx = recIds.length ? await prisma.receita.findMany({ where: { id: { in: recIds } }, select: { id: true, fxRule: true, fxEstimado: true, fxFixo: true, fxData: true, valorBrlFixo: true } }).catch(() => []) : []
  const fxPor = new Map(recsFx.map((r) => [r.id, r]))
  const cobs = ids.length ? await prisma.cobranca.findMany({ where: { obrigacaoId: { in: ids } }, select: { obrigacaoId: true, parcelas: { select: { status: true, valor: true, valorBrl: true, cambioAplicado: true, vencimento: true } } } }).catch(() => []) : []
  const parcPor = new Map<number, { status: string; valor: unknown; valorBrl: unknown; cambioAplicado: unknown; vencimento: Date }[]>()
  for (const c of cobs) { if (c.obrigacaoId != null) parcPor.set(c.obrigacaoId, [...(parcPor.get(c.obrigacaoId) ?? []), ...c.parcelas.map((p) => ({ status: p.status, valor: p.valor, valorBrl: p.valorBrl, cambioAplicado: p.cambioAplicado, vencimento: p.vencimento }))]) }
  const live = await cotacoesVivas().catch(() => ({ rates: {}, data: null }))
  return obrs.map((o) => {
    const p = projPor.get(o.id)
    const valorContratado = Number(o.valorContratado)
    const saldo = p ? Number(p.saldo) : valorContratado
    const recebido = p ? Number(p.recebidoBruto) : 0
    // FONTE ÚNICA de câmbio/BRL/aging: computeCambioAging (Ledger + fx congelado; custo sem
    // Receita usa cotação viva — nunca fx fixo/5.5).
    const rec = o.origemTipo === 'Receita' && o.origemId != null ? (fxPor.get(o.origemId) ?? null) : null
    const ca = computeCambioAging({
      moedaBase: String(o.moedaContratual), valorBase: valorContratado, saldoLedger: saldo, recebidoLedger: recebido,
      vencimento: o.vencimento ?? null, receita: rec as never, parcelas: (parcPor.get(o.id) ?? []) as never, live,
    })
    return {
      obrigacaoId: o.id, codigoOperacional: o.codigoOperacional, descricao: (o.itemCatalogoId ? itemPor.get(o.itemCatalogoId) : null) ?? o.observacoes ?? null, natureza: o.natureza, direcao: o.direcao,
      status: o.status, processoId: o.processoId, moeda: String(o.moedaContratual),
      valorContratado, saldo, recebido,
      vencimento: o.vencimento ? o.vencimento.toISOString() : null, origemTipo: o.origemTipo ?? null,
      criadoEm: o.criadoEm ? o.criadoEm.toISOString() : null,
      responsavel: o.criadoPorId != null ? (userPor.get(o.criadoPorId) ?? null) : null,
      requerente: (() => { const pid = primPart.get(o.id); return pid != null ? (pessoaNomeReq.get(pid) ?? null) : null })(),
      temAbertura: comAbertura.has(o.id),
      contratadoBrl: ca.valorContratadoBrl, recebidoBrl: ca.recebidoBrl, saldoBrl: ca.saldoBrl,
      aVencerBrl: ca.aVencerBrl, vencidoBrl: ca.vencidoBrl, cotacao: ca.cotacaoAplicada, statusAging: ca.statusLabel,
      // ETAPA 3 — ausência de cotação é explícita: > 0 significa que os campos
      // *Brl acima NÃO representam este montante (que está na moeda de origem).
      naoConvertido: ca.valorNaoConvertido,
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
