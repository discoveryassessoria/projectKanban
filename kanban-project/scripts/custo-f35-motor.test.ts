// F3.5 — Motor de Custo V3-native. Testa os DOIS blocos que o motor de fase agora usa no
// lugar do model Custo legado:
//  (1) criarObrigacaoEconomicaComLedgerTx — cria a obrigação (CUSTO/A_PAGAR) + Ledger
//      DENTRO da transação do motor (mesma tx do MotorArtefato), idempotente por origem;
//  (2) removerObrigacaoOrfaTx — undo da reconciliação: remove o órfão SEM pagamento e
//      LANÇA (preserva) quando há pagamento (guarda-se-paga; mesma semântica do FK legado).
import { prisma } from '@/lib/prisma'
import { criarObrigacaoEconomicaComLedger, criarObrigacaoEconomicaComLedgerTx, removerObrigacaoOrfaTx } from '@/lib/financeiro/ledger/ledger-service'
import { registrarOcorrencia } from '@/lib/financeiro/ocorrencias/ocorrencia-service'
import { listarObrigacoes } from '@/lib/financeiro/leitura/consultas'

let ok = 0, fail = 0
const chk = (c: boolean, m: string) => { if (c) { ok++; console.log('  ✅', m) } else { fail++; console.log('  ❌', m) } }
const TS = Date.now()

async function main() {
  const PROC = 16

  // (1) criação V3-native na tx (o que criarCusto do motor faz agora)
  let obrId1 = 0
  await prisma.$transaction(async (tx) => {
    const r = await criarObrigacaoEconomicaComLedgerTx(tx, { natureza: 'CUSTO', valorContratado: 500, moedaContratual: 'BRL', codigoOperacional: `CUS-${TS}`, processoId: PROC, observacoes: 'Custo motor V3-native', origemTipo: 'nativo', origemId: null })
    obrId1 = r.obrigacaoId
  })
  const o1 = await prisma.obrigacaoEconomica.findUnique({ where: { id: obrId1 }, select: { natureza: true, direcao: true, status: true } })
  chk(o1?.natureza === 'CUSTO' && o1?.direcao === 'A_PAGAR' && o1?.status === 'ATIVO', `obrigação CUSTO/A_PAGAR/ATIVO criada na tx (${JSON.stringify(o1)})`)
  const lg1 = await prisma.ledgerFinanceiro.findUnique({ where: { obrigacaoId: obrId1 } })
  const pj1 = await prisma.saldoProjecao.findUnique({ where: { obrigacaoId: obrId1 } })
  chk(!!lg1 && !!pj1, 'Ledger + projeção criados atômicos')
  chk((await listarObrigacoes({ processoId: PROC, natureza: 'CUSTO' })).some((o) => o.obrigacaoId === obrId1), 'aparece nas consultas V3 (não é Custo legado)')
  const custoLegadoCriado = await prisma.custo.findFirst({ where: { codigo: `CUS-${TS}` } })
  chk(custoLegadoCriado === null, 'NÃO criou Custo legado (V3 é o único writer)')

  // (2a) undo remove órfão SEM pagamento
  const { obrigacaoId: orf } = await criarObrigacaoEconomicaComLedger({ natureza: 'CUSTO', valorContratado: 300, moedaContratual: 'BRL', processoId: PROC, origemTipo: 'nativo', origemId: null })
  await prisma.$transaction(async (tx) => { await removerObrigacaoOrfaTx(tx, orf) })
  chk((await prisma.obrigacaoEconomica.findUnique({ where: { id: orf } })) === null, 'órfão sem pagamento REMOVIDO (obrigação)')
  chk((await prisma.ledgerFinanceiro.findUnique({ where: { obrigacaoId: orf } })) === null, 'Ledger do órfão removido')
  chk((await prisma.saldoProjecao.findUnique({ where: { obrigacaoId: orf } })) === null, 'projeção do órfão removida')

  // (2b) guarda-se-paga: com pagamento, LANÇA e PRESERVA
  const { obrigacaoId: pago } = await criarObrigacaoEconomicaComLedger({ natureza: 'CUSTO', valorContratado: 400, moedaContratual: 'BRL', processoId: PROC, origemTipo: 'nativo', origemId: null })
  await registrarOcorrencia({ obrigacaoId: pago, tipo: 'PAGAMENTO_PARCIAL', valor: 100, moeda: 'BRL', criadoPorId: 1, idempotencyKey: `f35-pay-${TS}` } as any)
  let lancou = false
  try { await prisma.$transaction(async (tx) => { await removerObrigacaoOrfaTx(tx, pago) }) } catch { lancou = true }
  chk(lancou, 'guarda-se-paga: remoção de órfão COM pagamento LANÇA (bloqueia)')
  chk((await prisma.obrigacaoEconomica.findUnique({ where: { id: pago } })) != null, 'obrigação paga PRESERVADA (não removida)')

  // limpeza
  for (const id of [obrId1, pago]) {
    await prisma.ocorrenciaFinanceira.deleteMany({ where: { obrigacaoId: id } }).catch(() => {})
    await prisma.$executeRawUnsafe(`DELETE FROM "LedgerEntry" WHERE "ledgerId" IN (SELECT id FROM "LedgerFinanceiro" WHERE "obrigacaoId"=$1)`, id)
    await prisma.saldoProjecao.deleteMany({ where: { obrigacaoId: id } })
    await prisma.ledgerFinanceiro.deleteMany({ where: { obrigacaoId: id } })
    await prisma.domainOutbox.deleteMany({ where: { aggregateType: 'ObrigacaoEconomica', aggregateId: id } })
    await prisma.obrigacaoEconomica.delete({ where: { id } }).catch(() => {})
  }

  console.log(`\n${ok} passaram, ${fail} falharam`)
  await prisma.$disconnect()
  process.exit(fail ? 1 : 0)
}
main().catch((e) => { console.error(e); process.exit(1) })
