/**
 * int-geral-acoes-db — integração com PERSISTÊNCIA REAL (banco de teste).
 *   Pagamento GERAL com ajustes RATEADOS (rastreável por cobrança) · arquivar/desarquivar
 *   (não altera saldos) · idempotência da migration Receita.arquivadaEm.
 */
import { prisma } from '@/lib/prisma'
import { criarObrigacaoEconomicaComLedger } from '@/lib/financeiro/ledger/ledger-service'
import { registrarPagamentoGeral } from '@/lib/financeiro/pagamentos/registrar-pagamento-geral'
import { arquivarReceita } from '@/lib/financeiro/acoes/arquivar'

let passed = 0, failed = 0
const falhas: string[] = []
function ok(cond: boolean, nome: string) { if (cond) { passed++; console.log(`  ✅ ${nome}`) } else { failed++; falhas.push(nome); console.log(`  ❌ ${nome}`) } }
const near = (a: number, b: number) => Math.abs(a - b) < 0.02
const CFG = 9101

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
  await prisma.receitaRequerente.deleteMany({ where: { receitaId: { in: recIds } } }).catch(() => {})
  await prisma.receita.deleteMany({ where: { id: { in: recIds } } }).catch(() => {})
}

let PROC = 0
async function seed(nome: string, valor: number, idx: number) {
  const rec = await prisma.receita.create({ data: {
    codigo: `TGA-${CFG}-${idx}`, processoId: PROC, categoria: 'HONORARIOS' as never, descricao: `Honorários — ${nome}`,
    moeda: 'BRL' as never, valor, valorUnitario: valor, quantidade: 1, valorTotalCongelado: valor, fxEstimado: 1, fxRule: 'VARIAVEL' as never,
    nParcelas: 1, data1: new Date('2026-07-01'), periodicidade: 'Mensal', status: 'ATIVA' as never, origem: 'motor', origemLancamento: 'PROCESSO', naturezaLancamento: 'RECEITA',
    configFinanceiraId: CFG, phaseKey: 'GENEALOGIA', phaseCycle: 1,
  } })
  const { obrigacaoId } = await criarObrigacaoEconomicaComLedger({ natureza: 'RECEITA', valorContratado: valor, moedaContratual: 'BRL', codigoOperacional: rec.codigo, processoId: PROC, origemTipo: 'Receita', origemId: rec.id })
  const cob = await prisma.cobranca.create({ data: { receitaId: rec.id, processoId: PROC, valorTotal: valor, moeda: 'BRL' as never, status: 'ABERTA', obrigacaoId } })
  await prisma.parcelaFinanceira.create({ data: { cobrancaId: cob.id, numero: 1, vencimento: new Date('2026-08-01'), valor, status: 'PENDENTE' } })
  return { receitaId: rec.id, obrigacaoId }
}

async function main() {
  console.log('int-geral-acoes-db — persistência real\n')
  await limpar()
  await prisma.processo.deleteMany({ where: { nome: 'TESTE-GERAL-ACOES' } }).catch(() => {})
  PROC = (await prisma.processo.create({ data: { nome: 'TESTE-GERAL-ACOES', pais: 'Alemanha' } })).id

  // ── GERAL com ajustes RATEADOS: Marco 1000 / Matheus 2000; forma 2700 + desconto 300 ──
  const marco = await seed('Marco', 1000, 0)
  const matheus = await seed('Matheus', 2000, 1)
  const rg = await registrarPagamentoGeral({
    alocacoes: [{ obrigacaoId: marco.obrigacaoId, valor: 900 }, { obrigacaoId: matheus.obrigacaoId, valor: 1800 }],
    formas: [{ formaPagamentoId: 1, formaLabel: 'PIX', valor: 2700, contaId: 1 }],
    ajustes: { desconto: 300 },
  })
  ok(rg.ok, 'GERAL: pagamento geral com desconto registrado')
  const descMarco = await prisma.ocorrenciaFinanceira.findFirst({ where: { obrigacaoId: marco.obrigacaoId, tipo: 'DESCONTO' } })
  const descMatheus = await prisma.ocorrenciaFinanceira.findFirst({ where: { obrigacaoId: matheus.obrigacaoId, tipo: 'DESCONTO' } })
  ok(descMarco != null && near(Number(descMarco!.valor), 100), 'GERAL: desconto RATEADO em Marco = 100 (rastreável na cobrança dele)')
  ok(descMatheus != null && near(Number(descMatheus!.valor), 200), 'GERAL: desconto RATEADO em Matheus = 200 (não aplicado silenciosamente a outro)')
  const pMarco = await prisma.saldoProjecao.findUnique({ where: { obrigacaoId: marco.obrigacaoId } })
  const pMatheus = await prisma.saldoProjecao.findUnique({ where: { obrigacaoId: matheus.obrigacaoId } })
  ok(near(Number(pMarco?.saldo), 0), 'GERAL: Marco líquido (1000−100) quitado por 900 → saldo 0')
  ok(near(Number(pMatheus?.saldo), 0), 'GERAL: Matheus líquido (2000−200) quitado por 1800 → saldo 0')

  // ── arquivar / desarquivar (não altera saldos) ──
  const saldoAntes = Number((await prisma.saldoProjecao.findUnique({ where: { obrigacaoId: matheus.obrigacaoId } }))?.saldo)
  const arq = await arquivarReceita(String(matheus.obrigacaoId), { arquivar: true }, { usuarioId: null })
  ok(arq.arquivada && arq.arquivadaEm != null, 'arquivar: Receita marcada como arquivada (arquivadaEm setado)')
  const recArq = await prisma.receita.findUnique({ where: { id: matheus.receitaId }, select: { arquivadaEm: true, cancelada: true, status: true } })
  ok(recArq?.arquivadaEm != null && recArq?.cancelada === false && recArq?.status === 'ATIVA', 'arquivar: NÃO cancela nem muda status financeiro')
  const saldoDepois = Number((await prisma.saldoProjecao.findUnique({ where: { obrigacaoId: matheus.obrigacaoId } }))?.saldo)
  ok(near(saldoAntes, saldoDepois), 'arquivar: saldo inalterado')
  const desarq = await arquivarReceita(String(matheus.obrigacaoId), { arquivar: false }, { usuarioId: null })
  ok(!desarq.arquivada && desarq.arquivadaEm == null, 'desarquivar: arquivadaEm volta a null')

  // ── Migration Receita.arquivadaEm — idempotente (aplica 2x sem erro) ──
  const SQL = 'ALTER TABLE "Receita" ADD COLUMN IF NOT EXISTS "arquivadaEm" TIMESTAMP(3);'
  await prisma.$executeRawUnsafe(SQL)
  await prisma.$executeRawUnsafe(SQL)
  const col = await prisma.$queryRawUnsafe<any[]>(`SELECT column_name FROM information_schema.columns WHERE table_name='Receita' AND column_name='arquivadaEm';`)
  ok(Array.isArray(col) && col.length === 1, 'migration: arquivadaEm idempotente (ADD COLUMN IF NOT EXISTS 2x, coluna existe 1x)')

  console.log(`\n${passed} passaram, ${failed} falharam`)
  await limpar()
  await prisma.processo.deleteMany({ where: { nome: 'TESTE-GERAL-ACOES' } }).catch(() => {})
  await prisma.$disconnect()
  if (failed) { console.log('Falhas:', falhas.join(' | ')); process.exit(1) }
}
main().catch((e) => { console.error(e); process.exit(1) })
