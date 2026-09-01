/**
 * participante-conta — read-models da CONTA FINANCEIRA INDIVIDUAL do participante
 * e da TIMELINE separada (geral × individual). Persistência REAL contra o banco de
 * teste (.env.test → kanban_test). NUNCA produção.
 *
 * Prova:
 *   • carregarContaParticipante devolve o shape completo (resumo/parcelas/cobrancas/
 *     pagamentos/documentos/historico) e resumo.saldoBrl VEM do Ledger (== SaldoProjecao).
 *   • timelineIndividualParticipante NÃO traz eventos globais (criação/cancelamento).
 *   • timelineGeralReceita NÃO traz eventos individuais de pagamento (e vice-versa).
 *
 * Env carregado via dotenv ANTES de importar o Prisma (o client lê a URL na construção).
 */
import { config } from 'dotenv'
config({ path: '.env.test' })

let passed = 0, failed = 0
const bugs: string[] = []
function ok(cond: boolean, nome: string) { if (cond) { passed++; console.log(`  ✅ ${nome}`) } else { failed++; bugs.push(nome); console.log(`  ❌ ${nome}`) } }
const near = (a: number, b: number) => Math.abs(a - b) < 0.02

const PROC_ID = 16
const COD = 'PCONTA-TST'
const CFG = 99016

async function main() {
  const url = process.env.PRISMA_DATABASE_URL ?? ''
  if (/prod|prisma-data|cloud/i.test(url) && !/kanban_test|127\.0\.0\.1|localhost/i.test(url)) {
    console.error('ABORTADO: PRISMA_DATABASE_URL não aponta para banco de teste local.'); process.exit(1)
  }
  const { prisma } = await import('@/lib/prisma')
  const { criarObrigacaoEconomicaComLedger } = await import('@/lib/financeiro/ledger/ledger-service')
  const { registrarPagamentoComposto } = await import('@/lib/financeiro/pagamentos/registrar-pagamento-composto')
  const { carregarContaParticipante } = await import('@/lib/financeiro/leitura/participante-conta')
  const { timelineGeralReceita, timelineIndividualParticipante } = await import('@/lib/financeiro/leitura/timeline-financeira')

  async function limpar() {
    const recs = await prisma.receita.findMany({ where: { configFinanceiraId: CFG }, select: { id: true } })
    const recIds = recs.map((r) => r.id)
    const obrs = await prisma.obrigacaoEconomica.findMany({ where: { origemTipo: 'Receita', origemId: { in: recIds } }, select: { id: true } })
    const oid = obrs.map((o) => o.id)
    await prisma.receitaDocumento.deleteMany({ where: { obrigacaoId: { in: oid } } }).catch(() => {})
    await prisma.aplicacaoFinanceira.deleteMany({ where: { ocorrencia: { obrigacaoId: { in: oid } } } }).catch(() => {})
    await prisma.ledgerEntry.deleteMany({ where: { obrigacaoId: { in: oid } } }).catch(() => {})
    await prisma.ocorrenciaFinanceira.deleteMany({ where: { obrigacaoId: { in: oid } } }).catch(() => {})
    await prisma.saldoProjecao.deleteMany({ where: { obrigacaoId: { in: oid } } }).catch(() => {})
    await prisma.creditoFinanceiro.deleteMany({ where: { obrigacaoId: { in: oid } } }).catch(() => {})
    await prisma.ledgerFinanceiro.deleteMany({ where: { obrigacaoId: { in: oid } } }).catch(() => {})
    await prisma.parcelaFinanceira.deleteMany({ where: { receitaId: { in: recIds } } }).catch(() => {})
    await prisma.cobranca.deleteMany({ where: { receitaId: { in: recIds } } }).catch(() => {})
    await prisma.domainOutbox.deleteMany({ where: { aggregateType: 'ObrigacaoEconomica', aggregateId: { in: oid } } }).catch(() => {})
    await prisma.obrigacaoEconomica.deleteMany({ where: { id: { in: oid } } }).catch(() => {})
    await prisma.receitaRequerente.deleteMany({ where: { receitaId: { in: recIds } } }).catch(() => {})
    await prisma.eventoFinanceiro.deleteMany({ where: { receitaId: { in: recIds } } }).catch(() => {})
    await prisma.receita.deleteMany({ where: { id: { in: recIds } } }).catch(() => {})
  }

  console.log('participante-conta — read-models de conta individual + timeline separada\n')
  await limpar()
  // Processo 16 existe (upsert mínimo).
  await prisma.processo.upsert({ where: { id: PROC_ID }, update: {}, create: { id: PROC_ID, nome: 'TESTE-PARTICIPANTE-CONTA',} }).catch(() => {})

  // ── Seed: Receita RECEITA (1 participante) no processo 16, BRL 5.000 ──
  const rec = await prisma.receita.create({ data: {
    codigo: `${COD}-1`, processoId: PROC_ID, categoria: 'HONORARIOS' as never, descricao: 'Honorários — participante teste',
    moeda: 'BRL' as never, valor: 5000, valorUnitario: 5000, quantidade: 1, valorTotalCongelado: 5000,
    fxEstimado: 1, fxRule: 'VARIAVEL' as never, nParcelas: 1, data1: new Date('2026-07-01'), periodicidade: 'Mensal',
    status: 'ATIVA' as never, origem: 'motor', origemLancamento: 'PROCESSO', naturezaLancamento: 'RECEITA',
    configFinanceiraId: CFG, regraFinanceiraId: 88016, phaseKey: 'GENEALOGIA', phaseCycle: 1,
    requerentes: { create: { idx: 0, nome: 'Ana Teste' } },
  } })
  const { obrigacaoId } = await criarObrigacaoEconomicaComLedger({ natureza: 'RECEITA', valorContratado: 5000, moedaContratual: 'BRL', codigoOperacional: rec.codigo, processoId: PROC_ID, origemTipo: 'Receita', origemId: rec.id })
  const cob = await prisma.cobranca.create({ data: { receitaId: rec.id, processoId: PROC_ID, valorTotal: 5000, moeda: 'BRL' as never, status: 'ABERTA', obrigacaoId, enviadaEm: new Date('2026-07-10') } })
  await prisma.parcelaFinanceira.create({ data: { cobrancaId: cob.id, receitaId: rec.id, numero: 1, vencimento: new Date('2026-08-01'), valor: 5000, status: 'PENDENTE' } })
  await prisma.receitaDocumento.create({ data: { obrigacaoId, arquivoUrl: 'https://x/contrato.pdf', arquivoNome: 'contrato.pdf', tipo: 'contrato' } })

  // pagamento parcial 2.000 → recebido no LEDGER; saldo 3.000
  const pg = await registrarPagamentoComposto({ obrigacaoId, moeda: 'BRL', formas: [{ formaPagamentoId: 1, formaLabel: 'PIX', valor: 2000, contaId: 1, contaLabel: 'Banco Inter' }], saldoSelecionado: 5000, criadoPorId: null })
  ok(pg.ok, 'setup: pagamento parcial de 2.000 registrado')

  // ── 1) CONTA INDIVIDUAL — shape + saldo do Ledger ──
  const conta = await carregarContaParticipante(obrigacaoId)
  ok(conta != null, 'conta carregada')
  if (!conta) { console.log('\nFALHAS:', bugs.join(' | ')); process.exit(1) }
  ok(conta.obrigacaoId === obrigacaoId, 'conta.obrigacaoId = obrigação do participante')
  ok(typeof conta.nome === 'string' && conta.papel != null, 'conta traz nome + papel do participante')
  const r = conta.resumo
  const temResumo = ['valorContratadoBrl', 'recebidoBrl', 'saldoBrl', 'aVencerBrl', 'vencidoBrl', 'statusAging', 'cotacao', 'moeda', 'valorBase'].every((k) => k in r)
  ok(temResumo, 'resumo tem todas as chaves (contratado/recebido/saldo/aVencer/vencido/aging/cotacao/moeda/base)')
  ok(r.moeda === 'BRL' && near(r.valorContratadoBrl, 5000), `resumo moeda BRL e contratado 5.000 (${r.moeda} ${r.valorContratadoBrl})`)
  ok(near(r.recebidoBrl, 2000), `resumo.recebidoBrl = 2.000 (${r.recebidoBrl})`)
  ok(Array.isArray(conta.parcelas) && conta.parcelas.length >= 1, `parcelas presentes (${conta.parcelas.length})`)
  ok(Array.isArray(conta.cobrancas) && conta.cobrancas.length >= 1, `cobrancas presentes (${conta.cobrancas.length})`)
  ok(Array.isArray(conta.pagamentos) && conta.pagamentos.length >= 1, `pagamentos presentes (${conta.pagamentos.length})`)
  ok(Array.isArray(conta.documentos) && conta.documentos.length >= 1, `documentos presentes (${conta.documentos.length})`)
  ok(Array.isArray(conta.historico) && conta.historico.length >= 1, `historico presente (${conta.historico.length})`)

  // saldoBrl VEM DO LEDGER: bate com a SaldoProjecao (verdade do razão)
  const proj = await prisma.saldoProjecao.findUnique({ where: { obrigacaoId } })
  ok(proj != null && near(r.saldoBrl, Number(proj!.saldo)), `resumo.saldoBrl (${r.saldoBrl}) == SaldoProjecao do Ledger (${Number(proj?.saldo)})`)
  ok(near(r.saldoBrl, 3000), `resumo.saldoBrl = 3.000 (contratado − recebido)`)

  // ── 2) TIMELINE INDIVIDUAL — só eventos do participante, NUNCA globais ──
  const GLOBAIS = ['OBRIGACAO_CRIADA', 'AJUSTE', 'CANCELAMENTO', 'ARQUIVAMENTO']
  const tind = await timelineIndividualParticipante(obrigacaoId)
  ok(tind.length > 0 && tind.every((e) => e.escopo === 'INDIVIDUAL'), `timeline individual: todos escopo INDIVIDUAL (${tind.length})`)
  ok(!tind.some((e) => GLOBAIS.includes(e.tipo)), 'timeline individual NÃO contém eventos globais (criação/cancelamento)')
  ok(tind.some((e) => e.tipo === 'PAGAMENTO' || e.tipo === 'PAGAMENTO_PARCIAL'), 'timeline individual contém o PAGAMENTO')
  ok(tind.some((e) => e.tipo === 'COBRANCA_ENVIADA'), 'timeline individual contém COBRANCA_ENVIADA')

  // ── 3) TIMELINE GERAL — só eventos de negócio, NUNCA pagamento individual ──
  const tger = await timelineGeralReceita(String(obrigacaoId))
  ok(tger.length > 0 && tger.every((e) => e.escopo === 'GERAL'), `timeline geral: todos escopo GERAL (${tger.length})`)
  ok(!tger.some((e) => ['PAGAMENTO', 'PAGAMENTO_PARCIAL', 'ESTORNO', 'COBRANCA_ENVIADA', 'VENCIMENTO'].includes(e.tipo)), 'timeline geral NÃO contém eventos individuais de pagamento/cobrança/vencimento')
  ok(tger.some((e) => e.tipo === 'OBRIGACAO_CRIADA'), 'timeline geral contém a criação (OBRIGACAO_CRIADA)')

  // escopos DISJUNTOS: nenhum id compartilhado entre as duas timelines
  const idsInd = new Set(tind.map((e) => e.id))
  ok(!tger.some((e) => idsInd.has(e.id)), 'timelines geral × individual são disjuntas (sem id compartilhado)')

  console.log(`\n${passed} passaram, ${failed} falharam`)
  await limpar()
  await prisma.$disconnect()
  if (failed) { console.log('FALHAS:', bugs.join(' | ')); process.exit(1) }
}
main().catch((e) => { console.error(e); process.exit(1) })
