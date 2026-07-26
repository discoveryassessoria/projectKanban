// scripts/extrato-ledger.test.ts — Extrato como PROJEÇÃO DO LEDGER (Etapa 2).
// Prova que cada fato do razão (contratação/pagamento/estorno) aparece no extrato,
// com valor BRL do Ledger e saldo por obrigação — sem valorContratado, sem câmbio.
// Env: DATABASE_URL/PRISMA_DATABASE_URL + FINANCEIRO_V3_*. npx tsx scripts/extrato-ledger.test.ts
import { prisma } from '@/lib/prisma'
import { criarObrigacaoEconomicaComLedger } from '@/lib/financeiro/ledger/ledger-service'
import { registrarPagamentoComposto } from '@/lib/financeiro/pagamentos/registrar-pagamento-composto'
import { registrarOcorrencia } from '@/lib/financeiro/ocorrencias/ocorrencia-service'
import { listarExtratoLedger } from '@/lib/financeiro/leitura/extrato-ledger'

let ok = 0, fail = 0
const t = (n: string, c: boolean, extra = '') => { if (c) { ok++; console.log(`  ✅ ${n}`) } else { fail++; console.log(`  ❌ ${n} ${extra}`) } }
const CFG = 9600

async function main() {
  const proc = await prisma.processo.findFirst({ select: { id: true } })
  if (!proc) { console.error('sem processo'); process.exit(1) }
  const PROC = proc.id
  // limpeza
  const recs = await prisma.receita.findMany({ where: { configFinanceiraId: CFG }, select: { id: true } })
  const rids = recs.map((r) => r.id)
  const obrs0 = await prisma.obrigacaoEconomica.findMany({ where: { origemTipo: 'Receita', origemId: { in: rids } }, select: { id: true } })
  const oids0 = obrs0.map((o) => o.id)
  await prisma.ledgerEntry.deleteMany({ where: { obrigacaoId: { in: oids0 } } }).catch(() => {})
  await prisma.ocorrenciaFinanceira.deleteMany({ where: { obrigacaoId: { in: oids0 } } }).catch(() => {})
  await prisma.saldoProjecao.deleteMany({ where: { obrigacaoId: { in: oids0 } } }).catch(() => {})
  await prisma.ledgerFinanceiro.deleteMany({ where: { obrigacaoId: { in: oids0 } } }).catch(() => {})
  await prisma.parcelaFinanceira.deleteMany({ where: { receitaId: { in: rids } } }).catch(() => {})
  await prisma.cobranca.deleteMany({ where: { receitaId: { in: rids } } }).catch(() => {})
  await prisma.obrigacaoEconomica.deleteMany({ where: { id: { in: oids0 } } }).catch(() => {})
  await prisma.receita.deleteMany({ where: { id: { in: rids } } }).catch(() => {})

  // seed: 1 receita BRL 1000 no processo
  const rec = await prisma.receita.create({ data: { codigo: `EXT-${CFG}`, processoId: PROC, categoria: 'HONORARIOS' as never, descricao: 'Extrato teste', moeda: 'BRL' as never, valor: 1000, valorUnitario: 1000, quantidade: 1, valorTotalCongelado: 1000, fxEstimado: 1, fxRule: 'VARIAVEL' as never, nParcelas: 1, data1: new Date('2026-07-01'), periodicidade: 'Mensal', status: 'ATIVA' as never, origem: 'motor', origemLancamento: 'PROCESSO', naturezaLancamento: 'RECEITA', configFinanceiraId: CFG } })
  const { obrigacaoId } = await criarObrigacaoEconomicaComLedger({ natureza: 'RECEITA', valorContratado: 1000, moedaContratual: 'BRL', codigoOperacional: rec.codigo, processoId: PROC, origemTipo: 'Receita', origemId: rec.id })
  const cob = await prisma.cobranca.create({ data: { receitaId: rec.id, processoId: PROC, valorTotal: 1000, moeda: 'BRL' as never, status: 'ABERTA', obrigacaoId } })
  await prisma.parcelaFinanceira.create({ data: { cobrancaId: cob.id, numero: 1, vencimento: new Date('2026-08-01'), valor: 1000, status: 'PENDENTE' } })

  // 1) só contratação → extrato tem 1 movimento CONTRATACAO, saldo 1000
  let mv = await listarExtratoLedger(PROC)
  const dessa = () => mv.filter((m) => m.obrigacaoId === obrigacaoId)
  t('contratação no extrato', dessa().some((m) => m.tipo === 'CONTRATACAO' && m.valorBrl === 1000))

  // 2) pagamento 400 → extrato ganha PAGAMENTO (ENTRADA 400), saldo obrigação 600
  await registrarPagamentoComposto({ obrigacaoId, formas: [{ formaPagamentoId: 1, valor: 400, contaId: 1 }], idempotencyKey: 'ext-pag' })
  mv = await listarExtratoLedger(PROC)
  const pag = dessa().find((m) => m.tipo === 'PAGAMENTO')
  t('pagamento no extrato (ENTRADA 400)', !!pag && pag.entradaSaida === 'ENTRADA' && pag.valorBrl === 400, JSON.stringify(pag))
  t('saldo da obrigação após pagamento = 600', dessa().some((m) => m.tipo === 'PAGAMENTO' && m.saldoObrigacaoApos === 600))

  // 3) estorno do pagamento → extrato ganha ESTORNO
  const pagOc = await prisma.ocorrenciaFinanceira.findFirst({ where: { obrigacaoId, tipo: 'PAGAMENTO', status: 'PROCESSADA' }, orderBy: { id: 'desc' } })
  await registrarOcorrencia({ obrigacaoId, tipo: 'ESTORNO', valor: 400, estornaOcorrenciaId: pagOc!.id, idempotencyKey: 'ext-est', observacao: '[Erro operacional]' })
  mv = await listarExtratoLedger(PROC)
  t('estorno no extrato', dessa().some((m) => m.tipo === 'ESTORNO'))
  t('saldo da obrigação volta a 1000 após estorno', dessa()[0]?.saldoObrigacaoApos === 1000 || dessa().some((m) => m.tipo === 'ESTORNO' && m.saldoObrigacaoApos === 1000))

  // cronológico decrescente (mais recente primeiro)
  const datas = dessa().map((m) => new Date(m.data).getTime())
  t('ordem cronológica decrescente', datas.every((d, i) => i === 0 || datas[i - 1] >= d))

  // limpeza
  await prisma.ledgerEntry.deleteMany({ where: { obrigacaoId } }).catch(() => {})
  await prisma.ocorrenciaFinanceira.deleteMany({ where: { obrigacaoId } }).catch(() => {})
  await prisma.saldoProjecao.deleteMany({ where: { obrigacaoId } }).catch(() => {})
  await prisma.ledgerFinanceiro.deleteMany({ where: { obrigacaoId } }).catch(() => {})
  await prisma.parcelaFinanceira.deleteMany({ where: { receitaId: rec.id } }).catch(() => {})
  await prisma.cobranca.deleteMany({ where: { receitaId: rec.id } }).catch(() => {})
  await prisma.obrigacaoEconomica.delete({ where: { id: obrigacaoId } }).catch(() => {})
  await prisma.receita.delete({ where: { id: rec.id } }).catch(() => {})

  console.log(`\n${fail === 0 ? '✅' : '❌'} extrato-ledger: ${ok} ok, ${fail} falhas`)
  process.exit(fail === 0 ? 0 : 1)
}
main().catch((e) => { console.error(e); process.exit(1) })
