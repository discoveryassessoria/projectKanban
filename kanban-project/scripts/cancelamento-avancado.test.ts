// scripts/cancelamento-avancado.test.ts
// ============================================================================
// GUARDA — Cancelamento profissional da Receita (persistência REAL, banco de teste).
// Cobre: PARCIAL_VALOR/PARCIAL_PERCENTUAL reduzem o SALDO no Ledger sem tocar
// pagamento; TOTAL cancela; previsão BATE com execução; pagamento confirmado
// NUNCA é revertido; ocorrência ESTORNO + auditoria gravadas; guarda valor>saldo.
// Rodar: DATABASE_URL=...kanban_test (+ PRISMA_/DIRECT_) FINANCEIRO_V3_POSICAO_READ=1
// ============================================================================
import { prisma } from '@/lib/prisma'
import { criarObrigacaoEconomicaComLedger } from '@/lib/financeiro/ledger/ledger-service'
import { registrarOcorrencia } from '@/lib/financeiro/ocorrencias/ocorrencia-service'
import { previsaoCancelamento, executarCancelamento } from '@/lib/financeiro/acoes/cancelamento-avancado'

let passed = 0, failed = 0
const falhas: string[] = []
function ok(cond: boolean, nome: string) { if (cond) { passed++; console.log(`  ✅ ${nome}`) } else { failed++; falhas.push(nome); console.log(`  ❌ ${nome}`) } }
const near = (a: number, b: number) => Math.abs(a - b) < 0.02
const CFG = 91777
const sec = (t: string) => console.log(`\n${t}`)

async function limpar() {
  const recs = await prisma.receita.findMany({ where: { configFinanceiraId: CFG }, select: { id: true } })
  const recIds = recs.map((r) => r.id)
  const obrs = await prisma.obrigacaoEconomica.findMany({ where: { origemTipo: 'Receita', origemId: { in: recIds } }, select: { id: true } })
  const obrIds = obrs.map((o) => o.id)
  await prisma.aplicacaoFinanceira.deleteMany({ where: { ocorrencia: { obrigacaoId: { in: obrIds } } } }).catch(() => {})
  await prisma.ledgerEntry.deleteMany({ where: { obrigacaoId: { in: obrIds } } }).catch(() => {})
  await prisma.ocorrenciaFinanceira.deleteMany({ where: { obrigacaoId: { in: obrIds } } }).catch(() => {})
  await prisma.saldoProjecao.deleteMany({ where: { obrigacaoId: { in: obrIds } } }).catch(() => {})
  await prisma.ledgerFinanceiro.deleteMany({ where: { obrigacaoId: { in: obrIds } } }).catch(() => {})
  await prisma.parcelaFinanceira.deleteMany({ where: { receitaId: { in: recIds } } }).catch(() => {})
  await prisma.cobranca.deleteMany({ where: { receitaId: { in: recIds } } }).catch(() => {})
  await prisma.obrigacaoEconomica.deleteMany({ where: { id: { in: obrIds } } }).catch(() => {})
  await prisma.eventoFinanceiro.deleteMany({ where: { receitaId: { in: recIds } } }).catch(() => {})
  await prisma.receitaRequerente.deleteMany({ where: { receitaId: { in: recIds } } }).catch(() => {})
  await prisma.receita.deleteMany({ where: { id: { in: recIds } } }).catch(() => {})
}

let PROC = 0
let seq = 0
async function seed(valor: number, nParcelas = 1): Promise<{ receitaId: number; obrigacaoId: number; parcelaIds: number[] }> {
  seq++
  const rec = await prisma.receita.create({ data: {
    codigo: `CA-${CFG}-${seq}-${Date.now() % 100000}`, processoId: PROC, categoria: 'HONORARIOS' as never, descricao: `Cancelamento — item ${seq}`,
    moeda: 'BRL' as never, valor, valorUnitario: valor, quantidade: 1, valorTotalCongelado: valor, fxEstimado: 1, fxRule: 'VARIAVEL' as never,
    nParcelas, data1: new Date('2026-07-01'), periodicidade: 'Mensal', status: 'ATIVA' as never, origem: 'motor', origemLancamento: 'PROCESSO', naturezaLancamento: 'RECEITA',
    configFinanceiraId: CFG, phaseKey: 'GENEALOGIA', phaseCycle: 1,
    requerentes: { create: { idx: 0, nome: `Requerente ${seq}` } },
  } })
  const { obrigacaoId } = await criarObrigacaoEconomicaComLedger({ natureza: 'RECEITA', valorContratado: valor, moedaContratual: 'BRL', codigoOperacional: rec.codigo, processoId: PROC, origemTipo: 'Receita', origemId: rec.id })
  const cob = await prisma.cobranca.create({ data: { receitaId: rec.id, processoId: PROC, valorTotal: valor, moeda: 'BRL' as never, status: 'ABERTA', obrigacaoId } })
  const parcelaIds: number[] = []
  const porParcela = Math.round((valor / nParcelas) * 100) / 100
  for (let i = 1; i <= nParcelas; i++) {
    const v = i === nParcelas ? Math.round((valor - porParcela * (nParcelas - 1)) * 100) / 100 : porParcela
    const p = await prisma.parcelaFinanceira.create({ data: { cobrancaId: cob.id, receitaId: rec.id, numero: i, vencimento: new Date('2026-08-01'), valor: v, status: 'PENDENTE' } })
    parcelaIds.push(p.id)
  }
  return { receitaId: rec.id, obrigacaoId, parcelaIds }
}

const saldo = async (obrigacaoId: number) => Number((await prisma.saldoProjecao.findUnique({ where: { obrigacaoId } }))?.saldo ?? NaN)
const recebido = async (obrigacaoId: number) => Number((await prisma.saldoProjecao.findUnique({ where: { obrigacaoId } }))?.recebidoBruto ?? NaN)

async function main() {
  console.log('cancelamento-avancado — persistência real\n')
  await limpar()
  await prisma.processo.deleteMany({ where: { nome: 'TESTE-CANCEL-AVANCADO' } }).catch(() => {})
  PROC = (await prisma.processo.create({ data: { nome: 'TESTE-CANCEL-AVANCADO',} })).id

  // ── 1 · PARCIAL_VALOR: previsão BATE com execução; reduz saldo, não toca pagamento ──
  sec('PARCIAL_VALOR')
  {
    const a = await seed(1000)
    const prev = await previsaoCancelamento({ ref: String(a.obrigacaoId), modo: 'PARCIAL_VALOR', valor: 300 })
    ok(prev != null && prev.ok, 'previsão ok')
    ok(prev != null && near(prev.recalculo.saldoAntes, 1000) && near(prev.recalculo.saldoDepois, 700), 'previsão: saldo 1000 → 700')
    ok(prev != null && prev.oQueCancela.valorBase === 300, 'previsão: cancela 300')
    ok(prev != null && prev.impactoContabil.length === 2 && prev.impactoContabil.every((p) => p.valor === 300), 'previsão: impacto contábil balanceado de 300')
    const r = await executarCancelamento({ ref: String(a.obrigacaoId), modo: 'PARCIAL_VALOR', valor: 300, motivo: 'desistência parcial' })
    ok(r.ok && near(r.valorCancelado, 300), 'execução: cancelou 300')
    ok(near(await saldo(a.obrigacaoId), 700), 'execução: saldo no Ledger virou 700 (PREVISÃO BATE)')
    ok(near(await recebido(a.obrigacaoId), 0), 'execução: recebido intacto (0)')
    const est = await prisma.ocorrenciaFinanceira.findFirst({ where: { obrigacaoId: a.obrigacaoId, tipo: 'ESTORNO' } })
    ok(est != null && near(Number(est!.valor), 300), 'ocorrência ESTORNO de 300 gravada')
    const ev = await prisma.eventoFinanceiro.findFirst({ where: { receitaId: a.receitaId, tipo: 'CANCELAMENTO' } })
    ok(ev != null && /desistência parcial/.test(ev!.descricao), 'auditoria (EventoFinanceiro CANCELAMENTO) com motivo')
    const obr = await prisma.obrigacaoEconomica.findUnique({ where: { id: a.obrigacaoId }, select: { valorContratado: true } })
    ok(near(Number(obr?.valorContratado), 700), 'valorContratado espelha o Ledger (700)')
    const pend = await prisma.parcelaFinanceira.findMany({ where: { receitaId: a.receitaId, status: 'PENDENTE' } })
    ok(near(pend.reduce((s, p) => s + Number(p.valor), 0), 700), 'cobrança aberta reescalada para 700')
  }

  // ── 2 · PARCIAL_PERCENTUAL sobre saldo aberto (com pagamento parcial) ──
  sec('PARCIAL_PERCENTUAL + pagamento confirmado NUNCA revertido')
  {
    const b = await seed(1000)
    await registrarOcorrencia({ obrigacaoId: b.obrigacaoId, tipo: 'PAGAMENTO', valor: 400, moeda: 'BRL' }) // saldo 600, recebido 400
    ok(near(await saldo(b.obrigacaoId), 600) && near(await recebido(b.obrigacaoId), 400), 'setup: saldo 600 / recebido 400')
    const prev = await previsaoCancelamento({ ref: String(b.obrigacaoId), modo: 'PARCIAL_PERCENTUAL', percentual: 50 }) // 50% de 600 = 300
    ok(prev != null && prev.oQueCancela.valorBase === 300 && near(prev.recalculo.saldoDepois, 300), 'previsão: 50% do saldo aberto (300) → saldo 300')
    const r = await executarCancelamento({ ref: String(b.obrigacaoId), modo: 'PARCIAL_PERCENTUAL', percentual: 50, motivo: 'renegociação' })
    ok(r.ok && near(r.valorCancelado, 300), 'execução: cancelou 300 (50% do aberto)')
    ok(near(await saldo(b.obrigacaoId), 300), 'saldo 600 → 300 (previsão bate)')
    ok(near(await recebido(b.obrigacaoId), 400), 'PAGAMENTO CONFIRMADO (400) NUNCA foi revertido')
  }

  // ── 3 · guarda: valor > saldo aberto → erro claro ──
  sec('Guarda valor > saldo aberto')
  {
    const c = await seed(500)
    await registrarOcorrencia({ obrigacaoId: c.obrigacaoId, tipo: 'PAGAMENTO', valor: 200, moeda: 'BRL' }) // saldo 300
    const prev = await previsaoCancelamento({ ref: String(c.obrigacaoId), modo: 'PARCIAL_VALOR', valor: 400 })
    ok(prev != null && !prev.ok && /maior que o saldo/i.test(prev.erros.join(' ')), 'previsão: erro claro (400 > saldo 300)')
    const r = await executarCancelamento({ ref: String(c.obrigacaoId), modo: 'PARCIAL_VALOR', valor: 400 })
    ok(!r.ok && r.erros.length > 0, 'execução bloqueada (não grava)')
    ok(near(await saldo(c.obrigacaoId), 300) && near(await recebido(c.obrigacaoId), 200), 'nada mudou após bloqueio')
  }

  // ── 4 · POR_PARCELA ──
  sec('POR_PARCELA')
  {
    const d = await seed(900, 3) // 3 parcelas de 300
    const alvo = d.parcelaIds.slice(0, 1) // cancela 1 parcela = 300
    const prev = await previsaoCancelamento({ ref: String(d.obrigacaoId), modo: 'POR_PARCELA', parcelaIds: alvo })
    ok(prev != null && prev.oQueCancela.valorBase === 300 && prev.recalculo.parcelasAfetadas.length === 1, 'previsão: 1 parcela (300)')
    const r = await executarCancelamento({ ref: String(d.obrigacaoId), modo: 'POR_PARCELA', parcelaIds: alvo, motivo: 'parcela indevida' })
    ok(r.ok && near(r.valorCancelado, 300), 'execução: cancelou 300 em parcela')
    ok(near(await saldo(d.obrigacaoId), 600), 'saldo 900 → 600')
    const pcanc = await prisma.parcelaFinanceira.findUnique({ where: { id: alvo[0] }, select: { status: true } })
    ok(pcanc?.status === 'CANCELADA', 'parcela alvo marcada CANCELADA')
  }

  // ── 5 · TOTAL cancela ──
  sec('TOTAL')
  {
    const e = await seed(1000)
    const prev = await previsaoCancelamento({ ref: String(e.obrigacaoId), modo: 'TOTAL' })
    ok(prev != null && prev.ok && near(prev.recalculo.saldoDepois, 0), 'previsão TOTAL: saldo → 0')
    const r = await executarCancelamento({ ref: String(e.obrigacaoId), modo: 'TOTAL', motivo: 'cancelamento total' })
    ok(r.ok && r.statusObrigacao === 'CANCELADO', 'execução TOTAL: obrigação CANCELADO')
    ok(near(await saldo(e.obrigacaoId), 0), 'saldo zerado')
    const obr = await prisma.obrigacaoEconomica.findUnique({ where: { id: e.obrigacaoId }, select: { status: true } })
    ok(obr?.status === 'CANCELADO', 'status persistido CANCELADO')
    const rec = await prisma.receita.findUnique({ where: { id: e.receitaId }, select: { cancelada: true, status: true } })
    ok(rec?.cancelada === true && rec?.status === 'CANCELADA', 'Receita marcada cancelada')
  }

  // ── 6 · TOTAL bloqueado quando há pagamento confirmado (nunca reverte) ──
  sec('TOTAL bloqueado com pagamento confirmado')
  {
    const f = await seed(1000)
    await registrarOcorrencia({ obrigacaoId: f.obrigacaoId, tipo: 'PAGAMENTO', valor: 400, moeda: 'BRL' })
    const prev = await previsaoCancelamento({ ref: String(f.obrigacaoId), modo: 'TOTAL' })
    ok(prev != null && !prev.ok && /estorne/i.test(prev.erros.join(' ')), 'previsão TOTAL bloqueada (estorne antes)')
    const r = await executarCancelamento({ ref: String(f.obrigacaoId), modo: 'TOTAL' })
    ok(!r.ok, 'execução TOTAL bloqueada')
    ok(near(await recebido(f.obrigacaoId), 400), 'pagamento 400 preservado (nunca revertido)')
  }

  // ── 7 · idempotência (mesma idempotencyKey não duplica) ──
  sec('Idempotência')
  {
    const g = await seed(1000)
    const key = `cancel-test:${g.obrigacaoId}`
    await executarCancelamento({ ref: String(g.obrigacaoId), modo: 'PARCIAL_VALOR', valor: 200, idempotencyKey: key })
    await executarCancelamento({ ref: String(g.obrigacaoId), modo: 'PARCIAL_VALOR', valor: 200, idempotencyKey: key })
    ok(near(await saldo(g.obrigacaoId), 800), 'mesma key aplicada 1x só (saldo 800, não 600)')
    const ests = await prisma.ocorrenciaFinanceira.count({ where: { obrigacaoId: g.obrigacaoId, tipo: 'ESTORNO' } })
    ok(ests === 1, 'apenas 1 ocorrência ESTORNO (idempotente)')
  }

  console.log(`\n${passed} passaram, ${failed} falharam`)
  await limpar()
  await prisma.processo.deleteMany({ where: { nome: 'TESTE-CANCEL-AVANCADO' } }).catch(() => {})
  await prisma.$disconnect()
  if (failed) { console.log('Falhas:', falhas.join(' | ')); process.exit(1) }
}
main().catch((e) => { console.error(e); process.exit(1) })
