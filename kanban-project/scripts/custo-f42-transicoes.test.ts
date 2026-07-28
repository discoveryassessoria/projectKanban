// F4.2 — Transições de estado do custo dirigidas pelas AÇÕES do ciclo de vida.
// Server-side, transacional, auditado (LogAuditoria ESTADO_CUSTO), read-model atualizado.
import { prisma } from '@/lib/prisma'
import { criarObrigacaoEconomicaComLedger } from '@/lib/financeiro/ledger/ledger-service'
import { registrarOcorrencia } from '@/lib/financeiro/ocorrencias/ocorrencia-service'
import { cancelarObrigacao } from '@/lib/financeiro/extras/cancelar-lancamento'
import { executarCancelamento } from '@/lib/financeiro/acoes/cancelamento-avancado'
import { aplicarTransicaoEstadoCustoTx } from '@/lib/financeiro/acoes/estado-custo-service'
import { listarObrigacoes } from '@/lib/financeiro/leitura/consultas'

let ok = 0, fail = 0
const chk = (c: boolean, m: string) => { if (c) { ok++; console.log('  ✅', m) } else { fail++; console.log('  ❌', m) } }
const TS = Date.now()
const estado = async (id: number) => (await prisma.obrigacaoEconomica.findUnique({ where: { id }, select: { estadoCusto: true } }))?.estadoCusto
const temAudit = async (id: number, para: string) => !!(await prisma.logAuditoria.findFirst({ where: { entidade: 'ObrigacaoEconomica', entidadeId: id, acao: 'ESTADO_CUSTO', detalhes: { path: ['para'], equals: para } } }).catch(() => null))
const novoCusto = (v: number) => criarObrigacaoEconomicaComLedger({ natureza: 'CUSTO', valorContratado: v, moedaContratual: 'BRL', processoId: 16, origemTipo: 'nativo', origemId: null })
const limpar = async (id: number) => {
  await prisma.logAuditoria.deleteMany({ where: { entidade: 'ObrigacaoEconomica', entidadeId: id } }).catch(() => {})
  await prisma.ocorrenciaFinanceira.deleteMany({ where: { obrigacaoId: id } }).catch(() => {})
  await prisma.$executeRawUnsafe(`DELETE FROM "LedgerEntry" WHERE "ledgerId" IN (SELECT id FROM "LedgerFinanceiro" WHERE "obrigacaoId"=$1)`, id).catch(() => {})
  await prisma.saldoProjecao.deleteMany({ where: { obrigacaoId: id } }); await prisma.ledgerFinanceiro.deleteMany({ where: { obrigacaoId: id } })
  await prisma.domainOutbox.deleteMany({ where: { aggregateType: 'ObrigacaoEconomica', aggregateId: id } })
  await prisma.obrigacaoEconomica.delete({ where: { id } }).catch(() => {})
}

async function main() {
  // (A) pagamento parcial mantém CONTRATADO; pagamento total → PAGO
  const { obrigacaoId: a } = await novoCusto(1000)
  chk(await estado(a) === 'CONTRATADO', 'custo nasce CONTRATADO')
  chk((await listarObrigacoes({ processoId: 16, natureza: 'CUSTO' })).find((o) => o.obrigacaoId === a)?.estadoCusto === 'CONTRATADO', 'read-model expõe estadoCusto')
  const p1 = await registrarOcorrencia({ obrigacaoId: a, tipo: 'PAGAMENTO_PARCIAL', valor: 400, moeda: 'BRL', criadoPorId: 1, idempotencyKey: `a1-${TS}` } as any)
  chk(await estado(a) === 'CONTRATADO', 'pagamento PARCIAL não muda o estado (ainda CONTRATADO)')
  await registrarOcorrencia({ obrigacaoId: a, tipo: 'PAGAMENTO_PARCIAL', valor: 600, moeda: 'BRL', criadoPorId: 1, idempotencyKey: `a2-${TS}` } as any)
  chk(await estado(a) === 'PAGO', 'pagamento TOTAL → PAGO')
  chk(await temAudit(a, 'PAGO'), 'auditoria ESTADO_CUSTO → PAGO')

  // (B) conciliação de custo PAGO → CONCILIADO (transição usada pelo conciliacao-service)
  await prisma.$transaction(async (tx) => { await aplicarTransicaoEstadoCustoTx(tx, a, 'CONCILIADO', { motivo: 'conciliação bancária' }) })
  chk(await estado(a) === 'CONCILIADO', 'custo PAGO conciliado → CONCILIADO')

  // (C) estorno reabre saldo → CONTRATADO
  const { obrigacaoId: b } = await novoCusto(500)
  const pb = await registrarOcorrencia({ obrigacaoId: b, tipo: 'PAGAMENTO', valor: 500, moeda: 'BRL', criadoPorId: 1, idempotencyKey: `b1-${TS}` } as any)
  chk(await estado(b) === 'PAGO', 'custo b quitado → PAGO')
  await registrarOcorrencia({ obrigacaoId: b, tipo: 'ESTORNO', valor: 500, moeda: 'BRL', estornaOcorrenciaId: (pb as any).ocorrenciaId, criadoPorId: 1, idempotencyKey: `b2-${TS}` } as any)
  chk(await estado(b) === 'CONTRATADO', 'estorno reabriu saldo → CONTRATADO')

  // (D) cancelamento PARCIAL → CANCELADO_PARCIAL
  const { obrigacaoId: c } = await novoCusto(800)
  await executarCancelamento({ ref: String(c), modo: 'PARCIAL_VALOR', valor: 300, idempotencyKey: `c1-${TS}` }, { criadoPorId: 1 })
  chk(await estado(c) === 'CANCELADO_PARCIAL', 'cancelamento PARCIAL → CANCELADO_PARCIAL')

  // (E) cancelamento TOTAL → CANCELADO
  const { obrigacaoId: d } = await novoCusto(300)
  await cancelarObrigacao({ obrigacaoId: d, motivo: 'teste', criadoPorId: 1 })
  chk(await estado(d) === 'CANCELADO', 'cancelamento TOTAL → CANCELADO')
  chk(await temAudit(d, 'CANCELADO'), 'auditoria ESTADO_CUSTO → CANCELADO')

  // (F) REGRESSÃO Receita: pagamento de receita NÃO seta estadoCusto (null)
  const { obrigacaoId: r } = await criarObrigacaoEconomicaComLedger({ natureza: 'RECEITA', valorContratado: 200, moedaContratual: 'BRL', processoId: 16, origemTipo: 'nativo', origemId: null })
  await registrarOcorrencia({ obrigacaoId: r, tipo: 'PAGAMENTO', valor: 200, moeda: 'BRL', criadoPorId: 1, idempotencyKey: `r1-${TS}` } as any)
  chk(await estado(r) === null, 'Receita paga NÃO usa estadoCusto (null) — sem regressão')

  for (const id of [a, b, c, d, r]) await limpar(id)
  console.log(`\n${ok} passaram, ${fail} falharam`)
  await prisma.$disconnect()
  process.exit(fail ? 1 : 0)
}
main().catch((e) => { console.error(e); process.exit(1) })
