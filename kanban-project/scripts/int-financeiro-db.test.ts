/**
 * int-financeiro-db — testes de INTEGRAÇÃO com PERSISTÊNCIA REAL (banco de teste).
 * Sobe contra .env.test (Postgres local kanban_test). NUNCA produção.
 * Rodar: PRISMA_DATABASE_URL=... DIRECT_DATABASE_URL=... npx tsx scripts/int-financeiro-db.test.ts
 *
 * Cobre (persistência real, relendo do banco):
 *   Cenário 2  — pagar cobrança de Marco com Matheus como pagador; conferir redução da
 *                cobrança/participação de Marco, Matheus só como pagador, lançamentos criados.
 *   Cenário 10 — idempotência REAL: repetir confirmação com a mesma chave não duplica.
 */
import { prisma } from '@/lib/prisma'
import { criarObrigacaoEconomicaComLedger } from '@/lib/financeiro/ledger/ledger-service'
import { registrarPagamentoComposto } from '@/lib/financeiro/pagamentos/registrar-pagamento-composto'

let passed = 0, failed = 0
const falhas: string[] = []
function ok(cond: boolean, nome: string) { if (cond) { passed++; console.log(`  ✅ ${nome}`) } else { failed++; falhas.push(nome); console.log(`  ❌ ${nome}`) } }
const near = (a: number, b: number) => Math.abs(a - b) < 0.005

const GRUPO = { processoId: 0, configFinanceiraId: 9001, regraFinanceiraId: 8001, phaseKey: 'GENEALOGIA', phaseCycle: 1 }

async function limpar() {
  // limpa apenas o que este teste cria (config 9001)
  const recs = await prisma.receita.findMany({ where: { configFinanceiraId: GRUPO.configFinanceiraId }, select: { id: true } })
  const recIds = recs.map((r) => r.id)
  const obrs = await prisma.obrigacaoEconomica.findMany({ where: { origemTipo: 'Receita', origemId: { in: recIds } }, select: { id: true, ledger: { select: { id: true } } } })
  const obrIds = obrs.map((o) => o.id)
  await prisma.aplicacaoFinanceira.deleteMany({ where: { ocorrencia: { obrigacaoId: { in: obrIds } } } }).catch(() => {})
  await prisma.ledgerEntry.deleteMany({ where: { obrigacaoId: { in: obrIds } } }).catch(() => {})
  await prisma.ocorrenciaFinanceira.deleteMany({ where: { obrigacaoId: { in: obrIds } } }).catch(() => {})
  await prisma.saldoProjecao.deleteMany({ where: { obrigacaoId: { in: obrIds } } }).catch(() => {})
  await prisma.creditoFinanceiro.deleteMany({ where: { obrigacaoId: { in: obrIds } } }).catch(() => {})
  await prisma.ledgerFinanceiro.deleteMany({ where: { obrigacaoId: { in: obrIds } } }).catch(() => {})
  await prisma.parcelaFinanceira.deleteMany({ where: { receitaId: { in: recIds } } }).catch(() => {})
  await prisma.cobranca.deleteMany({ where: { receitaId: { in: recIds } } }).catch(() => {})
  await prisma.obrigacaoEconomica.deleteMany({ where: { id: { in: obrIds } } }).catch(() => {})
  await prisma.receitaRequerente.deleteMany({ where: { receitaId: { in: recIds } } }).catch(() => {})
  await prisma.receita.deleteMany({ where: { id: { in: recIds } } }).catch(() => {})
}

async function seedParticipante(nome: string, requerenteId: number, valor: number, idx: number) {
  const rec = await prisma.receita.create({ data: {
    codigo: `TST-${GRUPO.configFinanceiraId}-${idx}`, processoId: GRUPO.processoId, categoria: 'HONORARIOS' as never,
    descricao: `Honorários — Alemã${idx > 0 ? ` — Requerente adicional — ${nome}` : ''}`, moeda: 'BRL' as never, valor,
    valorUnitario: valor, quantidade: 1, valorTotalCongelado: valor, fxEstimado: 1, fxRule: 'VARIAVEL' as never,
    nParcelas: 1, data1: new Date('2026-07-01'), periodicidade: 'Mensal', status: 'ATIVA' as never,
    origem: 'motor', origemLancamento: 'PROCESSO', naturezaLancamento: 'RECEITA',
    configFinanceiraId: GRUPO.configFinanceiraId, regraFinanceiraId: GRUPO.regraFinanceiraId, phaseKey: GRUPO.phaseKey, phaseCycle: GRUPO.phaseCycle,
    requerentes: { create: { idx: 0, nome, requerenteId } },
  } })
  const { obrigacaoId } = await criarObrigacaoEconomicaComLedger({ natureza: 'RECEITA', valorContratado: valor, moedaContratual: 'BRL', codigoOperacional: rec.codigo, processoId: GRUPO.processoId, origemTipo: 'Receita', origemId: rec.id })
  // cobrança + parcela em aberto (para aplicar o pagamento)
  const cob = await prisma.cobranca.create({ data: { receitaId: rec.id, processoId: GRUPO.processoId, valorTotal: valor, moeda: 'BRL' as never, status: 'ABERTA', obrigacaoId } })
  await prisma.parcelaFinanceira.create({ data: { cobrancaId: cob.id, numero: 1, vencimento: new Date('2026-08-01'), valor, status: 'PENDENTE' } })
  return { receitaId: rec.id, obrigacaoId, cobrancaId: cob.id }
}

async function main() {
  console.log('int-financeiro-db — persistência real (banco de teste)\n')
  await limpar()
  await prisma.processo.deleteMany({ where: { nome: 'TESTE-INT-FINANCEIRO' } }).catch(() => {})
  const proc = await prisma.processo.create({ data: { nome: 'TESTE-INT-FINANCEIRO', pais: 'Alemanha' } })
  GRUPO.processoId = proc.id
  await prisma.requerente.deleteMany({ where: { nome: { in: ['Marco Kruger', 'Matheus Kruger'] }, cpf: 'TST' } }).catch(() => {})
  const reqMarco = await prisma.requerente.create({ data: { nome: 'Marco Kruger', cpf: 'TST' } })
  const reqMatheus = await prisma.requerente.create({ data: { nome: 'Matheus Kruger', cpf: 'TST' } })
  const ID_MATHEUS = reqMatheus.id

  // ── Seed: Receita consolidada Marco (10.981,08) + Matheus (17.081,68) = 28.062,76 ──
  const marco = await seedParticipante('Marco Kruger', reqMarco.id, 10981.08, 0)
  const matheus = await seedParticipante('Matheus Kruger', reqMatheus.id, 17081.68, 1)
  console.log('  seed: Marco obr', marco.obrigacaoId, '· Matheus obr', matheus.obrigacaoId)

  // ── Cenário 2 — pagar a cobrança de Marco com Matheus como PAGADOR ──
  const r2 = await registrarPagamentoComposto({
    obrigacaoId: marco.obrigacaoId, moeda: 'BRL',
    formas: [{ formaPagamentoId: 1, formaLabel: 'PIX', valor: 10981.08, contaId: 1, contaLabel: 'Banco Inter' }],
    pagador: { tipo: 'REQUERENTE', pessoaId: ID_MATHEUS }, // Matheus paga a cobrança de Marco
    saldoSelecionado: 10981.08, criadoPorId: null,
  })
  ok(r2.ok, 'cenário 2: pagamento registrado')

  const projMarco = await prisma.saldoProjecao.findUnique({ where: { obrigacaoId: marco.obrigacaoId } })
  ok(near(Number(projMarco?.recebidoBruto), 10981.08), 'cenário 2: Marco recebido = 10.981,08 (relido do banco)')
  ok(near(Number(projMarco?.saldo), 0), 'cenário 2: Marco saldo = 0 (cobrança quitada)')

  const projMatheus = await prisma.saldoProjecao.findUnique({ where: { obrigacaoId: matheus.obrigacaoId } })
  ok(near(Number(projMatheus?.recebidoBruto ?? 0), 0), 'cenário 2: Matheus NÃO recebeu na obrigação dele (só pagou a de Marco)')
  ok(near(Number(projMatheus?.saldo), 17081.68), 'cenário 2: Matheus saldo intacto = 17.081,68')

  const pgMarco = await prisma.ocorrenciaFinanceira.findFirst({ where: { obrigacaoId: marco.obrigacaoId, tipo: 'PAGAMENTO' } })
  const pagadorMarco = pgMarco?.pagadorId ? await prisma.pagador.findUnique({ where: { id: pgMarco.pagadorId } }) : null
  ok(pagadorMarco?.pessoaId === ID_MATHEUS, 'cenário 2: pagador do pagamento = Matheus, não Marco')
  const entriesMarco = await prisma.ledgerEntry.count({ where: { obrigacaoId: marco.obrigacaoId } })
  ok(entriesMarco >= 4, `cenário 2: lançamentos no ledger de Marco criados (${entriesMarco})`)

  const parcMarco = await prisma.parcelaFinanceira.findFirst({ where: { cobrancaId: marco.cobrancaId } })
  const aplic = await prisma.aplicacaoFinanceira.aggregate({ where: { parcelaId: parcMarco?.id }, _sum: { valorAplicado: true } })
  ok(near(Number(aplic._sum.valorAplicado ?? 0), 10981.08), 'cenário 2: aplicação imputada na parcela de Marco = 10.981,08')

  // ── Cenário 10 — idempotência REAL: repetir o pagamento com a MESMA chave não duplica ──
  const antes = await prisma.ocorrenciaFinanceira.count({ where: { obrigacaoId: matheus.obrigacaoId, tipo: 'PAGAMENTO' } })
  const chave = 'idem-teste-cenario10'
  const p1 = await registrarPagamentoComposto({ obrigacaoId: matheus.obrigacaoId, moeda: 'BRL', formas: [{ formaPagamentoId: 1, formaLabel: 'PIX', valor: 1000, contaId: 1 }], saldoSelecionado: 17081.68, idempotencyKey: chave })
  const p2 = await registrarPagamentoComposto({ obrigacaoId: matheus.obrigacaoId, moeda: 'BRL', formas: [{ formaPagamentoId: 1, formaLabel: 'PIX', valor: 1000, contaId: 1 }], saldoSelecionado: 17081.68, idempotencyKey: chave })
  ok(p1.ok && p2.ok, 'cenário 10: duas confirmações com a mesma chave retornam ok')
  const depois = await prisma.ocorrenciaFinanceira.count({ where: { obrigacaoId: matheus.obrigacaoId, tipo: 'PAGAMENTO' } })
  ok(depois - antes === 1, `cenário 10: apenas 1 pagamento persistido apesar de 2 requisições (antes ${antes} → depois ${depois})`)
  const projM2 = await prisma.saldoProjecao.findUnique({ where: { obrigacaoId: matheus.obrigacaoId } })
  ok(near(Number(projM2?.recebidoBruto), 1000), 'cenário 10: recebido = 1.000 (não 2.000) — idempotente na persistência')

  // ── Ledger de CRÉDITO — geração por excedente + utilização (razão imutável) ──
  const o1 = await seedParticipante('Marco Kruger', reqMarco.id, 1000, 10)
  const rg = await registrarPagamentoComposto({ obrigacaoId: o1.obrigacaoId, moeda: 'BRL', formas: [{ formaPagamentoId: 1, formaLabel: 'PIX', valor: 1200, contaId: 1 }], saldoSelecionado: 1000, excedenteTratamento: 'CREDITO' })
  ok(rg.ok && near(rg.excedente, 200), 'crédito: excedente de 200 identificado')
  const cred = await prisma.creditoFinanceiro.findFirst({ where: { obrigacaoId: o1.obrigacaoId, status: 'ABERTO' }, orderBy: { id: 'desc' } })
  ok(cred != null && near(Number(cred!.valor), 200), 'crédito: CreditoFinanceiro 200 ABERTO criado')
  const movG = await prisma.creditoMovimento.findFirst({ where: { creditoId: cred!.id, tipo: 'GERACAO' } })
  ok(movG != null && near(Number(movG!.saldoAnterior), 0) && near(Number(movG!.saldoPosterior), 200), 'crédito: movimento GERACAO 0→200 no razão imutável')
  ok(movG?.obrigacaoOrigemId === o1.obrigacaoId && !!movG?.correlationId, 'crédito: GERACAO tem origem + correlation id')

  // utilizar o crédito de 200 abatendo uma cobrança de O2 (forma 300 + crédito 200 = líquido 500)
  const o2 = await seedParticipante('Matheus Kruger', reqMatheus.id, 500, 11)
  const ru = await registrarPagamentoComposto({ obrigacaoId: o2.obrigacaoId, moeda: 'BRL', formas: [{ formaPagamentoId: 1, formaLabel: 'PIX', valor: 300, contaId: 1 }], ajustes: { creditoUtilizado: 200 }, saldoSelecionado: 500 })
  ok(ru.ok, 'crédito: pagamento com crédito utilizado registrado')
  const credDepois = await prisma.creditoFinanceiro.findUnique({ where: { id: cred!.id } })
  ok(credDepois != null && near(Number(credDepois!.valor), 0) && credDepois!.status === 'UTILIZADO', 'crédito: saldo do crédito reduzido a 0 e UTILIZADO')
  const movU = await prisma.creditoMovimento.findFirst({ where: { creditoId: cred!.id, tipo: 'UTILIZACAO' } })
  ok(movU != null && near(Number(movU!.saldoAnterior), 200) && near(Number(movU!.saldoPosterior), 0), 'crédito: movimento UTILIZACAO 200→0 (saldo anterior/posterior)')
  ok(movU?.obrigacaoDestinoId === o2.obrigacaoId, 'crédito: UTILIZACAO aponta a obrigação de destino')
  const projO2 = await prisma.saldoProjecao.findUnique({ where: { obrigacaoId: o2.obrigacaoId } })
  ok(near(Number(projO2?.saldo), 0), 'crédito: cobrança de destino liquidada (forma 300 + crédito 200 = 500)')

  console.log(`\n${passed} passaram, ${failed} falharam`)
  await limpar()
  await prisma.requerente.deleteMany({ where: { cpf: 'TST' } }).catch(() => {})
  await prisma.processo.deleteMany({ where: { nome: 'TESTE-INT-FINANCEIRO' } }).catch(() => {})
  await prisma.$disconnect()
  if (failed) { console.log('Falhas:', falhas.join(' | ')); process.exit(1) }
}
main().catch((e) => { console.error(e); process.exit(1) })
