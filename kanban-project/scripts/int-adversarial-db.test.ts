/**
 * int-adversarial-db — HOMOLOGAÇÃO: tenta QUEBRAR o financeiro contra persistência real.
 * Cada `ok` asserta o comportamento CORRETO esperado de um ERP. Falha = bug confirmado.
 */
import { prisma } from '@/lib/prisma'
import { criarObrigacaoEconomicaComLedger } from '@/lib/financeiro/ledger/ledger-service'
import { registrarPagamentoComposto } from '@/lib/financeiro/pagamentos/registrar-pagamento-composto'
import { registrarOcorrencia } from '@/lib/financeiro/ocorrencias/ocorrencia-service'
import { redistribuir } from '@/lib/financeiro/distribuicao/redistribuir-service'

import { exigirBancoDeTeste } from "./_banco-de-teste"

// TRAVA DE AMBIENTE: este arquivo ESCREVE. Sem banco de teste local, não roda.
exigirBancoDeTeste()

let passed = 0, failed = 0
const bugs: string[] = []
function ok(cond: boolean, nome: string) { if (cond) { passed++; console.log(`  ✅ ${nome}`) } else { failed++; bugs.push(nome); console.log(`  ❌ BUG: ${nome}`) } }
async function cenario(nome: string, fn: () => Promise<void>) { try { await fn() } catch (e) { failed++; const msg = `CRASH em "${nome}": ${e instanceof Error ? e.message : e}`; bugs.push(msg); console.log(`  ❌ BUG: ${msg}`) } }
const near = (a: number, b: number) => Math.abs(a - b) < 0.02
const CFG = 9201
let PROC = 0

async function limpar() {
  const recs = await prisma.receita.findMany({ where: { configFinanceiraId: CFG }, select: { id: true } })
  const recIds = recs.map((r) => r.id)
  const obrs = await prisma.obrigacaoEconomica.findMany({ where: { origemTipo: 'Receita', origemId: { in: recIds } }, select: { id: true } })
  const obrIds = obrs.map((o) => o.id)
  await prisma.aplicacaoFinanceira.deleteMany({ where: { ocorrencia: { obrigacaoId: { in: obrIds } } } }).catch(() => {})
  await prisma.ledgerEntry.deleteMany({ where: { obrigacaoId: { in: obrIds } } }).catch(() => {})
  await prisma.creditoMovimento.deleteMany({ where: { obrigacaoDestinoId: { in: obrIds } } }).catch(() => {})
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
async function seed(valor: number, idx: number, reqId?: number) {
  const rec = await prisma.receita.create({ data: {
    codigo: `ADV-${CFG}-${idx}-${Math.floor(valor)}`, processoId: PROC, categoria: 'HONORARIOS' as never, descricao: `Adv ${idx}`,
    moeda: 'BRL' as never, valor, valorUnitario: valor, quantidade: 1, valorTotalCongelado: valor, fxEstimado: 1, fxRule: 'VARIAVEL' as never,
    nParcelas: 1, data1: new Date('2026-07-01'), periodicidade: 'Mensal', status: 'ATIVA' as never, origem: 'motor', origemLancamento: 'PROCESSO', naturezaLancamento: 'RECEITA',
    configFinanceiraId: CFG, regraFinanceiraId: 1, phaseKey: 'GENEALOGIA', phaseCycle: 1,
    requerentes: reqId ? { create: { idx: 0, nome: 'Req', requerenteId: reqId } } : undefined,
  } })
  const { obrigacaoId } = await criarObrigacaoEconomicaComLedger({ natureza: 'RECEITA', valorContratado: valor, moedaContratual: 'BRL', codigoOperacional: rec.codigo, processoId: PROC, origemTipo: 'Receita', origemId: rec.id })
  const cob = await prisma.cobranca.create({ data: { receitaId: rec.id, processoId: PROC, valorTotal: valor, moeda: 'BRL' as never, status: 'ABERTA', obrigacaoId } })
  await prisma.parcelaFinanceira.create({ data: { cobrancaId: cob.id, numero: 1, vencimento: new Date('2026-08-01'), valor, status: 'PENDENTE' } })
  return { receitaId: rec.id, obrigacaoId }
}
const saldo = async (o: number) => Number((await prisma.saldoProjecao.findUnique({ where: { obrigacaoId: o } }))?.saldo ?? NaN)

async function main() {
  console.log('int-adversarial-db — tentando QUEBRAR\n')
  await limpar()
  await prisma.processo.deleteMany({ where: { nome: 'TESTE-ADV' } }).catch(() => {})
  PROC = (await prisma.processo.create({ data: { nome: 'TESTE-ADV', pais: 'Alemanha' } })).id

  // 1) DESCONTO MAIOR QUE O SALDO — não pode deixar o a receber NEGATIVO
  await cenario('adv1', async () => {
    const o = await seed(1000, 1)
    await registrarOcorrencia({ obrigacaoId: o.obrigacaoId, tipo: 'DESCONTO', valor: 2000, moeda: 'BRL' })
    const s = await saldo(o.obrigacaoId)
    ok(s >= -0.01, `desconto 2000 > saldo 1000 não deixa saldo negativo (saldo=${s.toFixed(2)})`)
  })

  // 2) CRÉDITO UTILIZADO MAIOR QUE O DISPONÍVEL — backend deve rejeitar (não confiar no front)
  await cenario('adv2', async () => {
    const o = await seed(1000, 2)
    const r = await registrarPagamentoComposto({ obrigacaoId: o.obrigacaoId, moeda: 'BRL', formas: [{ formaPagamentoId: 1, valor: 500, contaId: 1 }], ajustes: { creditoUtilizado: 5000 }, saldoSelecionado: 1000 })
    ok(!r.ok, `crédito utilizado 5000 sem crédito disponível é REJEITADO no backend (ok=${r.ok})`)
  })

  // 3) ESTORNO DUPLICADO — estornar o MESMO pagamento 2x não pode reverter em dobro
  await cenario('adv3', async () => {
    const o = await seed(1000, 3)
    await registrarPagamentoComposto({ obrigacaoId: o.obrigacaoId, moeda: 'BRL', formas: [{ formaPagamentoId: 1, valor: 1000, contaId: 1 }], saldoSelecionado: 1000, idempotencyKey: 'adv3' })
    const pg = await prisma.ocorrenciaFinanceira.findFirst({ where: { obrigacaoId: o.obrigacaoId, tipo: 'PAGAMENTO' } })
    await registrarOcorrencia({ obrigacaoId: o.obrigacaoId, tipo: 'ESTORNO', valor: 1000, estornaOcorrenciaId: pg!.id })
    let rejeitado = false
    try { await registrarOcorrencia({ obrigacaoId: o.obrigacaoId, tipo: 'ESTORNO', valor: 1000, estornaOcorrenciaId: pg!.id }) } catch { rejeitado = true } // 2º estorno do MESMO
    const s = await saldo(o.obrigacaoId)
    ok(rejeitado && near(s, 1000), `estorno duplicado do mesmo pagamento é REJEITADO e NÃO reverte em dobro (rejeitado=${rejeitado}, saldo=${s.toFixed(2)})`)
  })

  // 4) REDISTRIBUIR abaixo do já recebido — deve ser REJEITADO
  await cenario('adv4', async () => {
    const reqA = await prisma.requerente.create({ data: { nome: 'A', cpf: 'ADV' } })
    const reqB = await prisma.requerente.create({ data: { nome: 'B', cpf: 'ADV' } })
    const a = await seed(1000, 41, reqA.id)
    const b = await seed(1000, 42, reqB.id)
    // paga 800 em A
    await registrarPagamentoComposto({ obrigacaoId: a.obrigacaoId, moeda: 'BRL', formas: [{ formaPagamentoId: 1, valor: 800, contaId: 1 }], saldoSelecionado: 1000, idempotencyKey: 'adv4' })
    // tenta redistribuir: A=500 (abaixo dos 800 recebidos), B=1500 (total 2000 mantido)
    const r = await redistribuir({ ref: String(a.obrigacaoId), participantes: [{ obrigacaoId: a.obrigacaoId, incluido: true, valorBase: 500 }, { obrigacaoId: b.obrigacaoId, incluido: true, valorBase: 1500 }] })
    ok(!r.ok, `redistribuir A para 500 < recebido 800 é REJEITADO (ok=${r.ok})`)
  })

  // 5) REMOVER participante COM pagamento — deve ser REJEITADO
  await cenario('adv5', async () => {
    const reqC = await prisma.requerente.create({ data: { nome: 'C', cpf: 'ADV' } })
    const reqD = await prisma.requerente.create({ data: { nome: 'D', cpf: 'ADV' } })
    const c = await seed(1000, 51, reqC.id)
    const d = await seed(1000, 52, reqD.id)
    await registrarPagamentoComposto({ obrigacaoId: c.obrigacaoId, moeda: 'BRL', formas: [{ formaPagamentoId: 1, valor: 300, contaId: 1 }], saldoSelecionado: 1000, idempotencyKey: 'adv5' })
    const r = await redistribuir({ ref: String(c.obrigacaoId), participantes: [{ obrigacaoId: c.obrigacaoId, incluido: false, valorBase: 0 }, { obrigacaoId: d.obrigacaoId, incluido: true, valorBase: 2000 }] })
    ok(!r.ok, `remover participante C que tem pagamento é REJEITADO (ok=${r.ok})`)
  })

  // 6) PAGAMENTO NEGATIVO — não registra
  await cenario('adv6', async () => {
    const o = await seed(1000, 6)
    const r = await registrarPagamentoComposto({ obrigacaoId: o.obrigacaoId, moeda: 'BRL', formas: [{ formaPagamentoId: 1, valor: -500, contaId: 1 }], saldoSelecionado: 1000 })
    const s = await saldo(o.obrigacaoId)
    ok(!r.ok && near(s, 1000), `pagamento negativo NÃO é registrado e saldo intacto (ok=${r.ok}, saldo=${s.toFixed(2)})`)
  })

  // 7) TOTAIS FORJADOS pelo cliente — backend recalcula e REJEITA
  await cenario('adv7', async () => {
    const o = await seed(1000, 7)
    const r = await registrarPagamentoComposto({ obrigacaoId: o.obrigacaoId, moeda: 'BRL', formas: [{ formaPagamentoId: 1, valor: 500, contaId: 1 }], saldoSelecionado: 1000, totais: { totalInformado: 999, saldoRestante: 1 } })
    ok(!r.ok, `totais forjados (999≠500) são REJEITADOS no backend (ok=${r.ok})`)
  })

  console.log(`\n${passed} ok, ${failed} BUGS`)
  await limpar()
  await prisma.requerente.deleteMany({ where: { cpf: 'ADV' } }).catch(() => {})
  await prisma.processo.deleteMany({ where: { nome: 'TESTE-ADV' } }).catch(() => {})
  await prisma.$disconnect()
  if (failed) console.log('BUGS CONFIRMADOS:', bugs.join(' | '))
}
main().catch((e) => { console.error(e); process.exit(1) })
