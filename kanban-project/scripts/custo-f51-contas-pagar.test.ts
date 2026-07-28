// F5.1 — Contas a Pagar operacional (read-model V3, sem entidade nova). Prova os baldes
// (vencida/hoje/próxima/parcial/paga/cancelada), KPIs e agrupamentos; só A_PAGAR.
import { prisma } from '@/lib/prisma'
import { criarObrigacaoEconomicaComLedger } from '@/lib/financeiro/ledger/ledger-service'
import { registrarOcorrencia } from '@/lib/financeiro/ocorrencias/ocorrencia-service'
import { cancelarObrigacao } from '@/lib/financeiro/extras/cancelar-lancamento'
import { listarContasAPagar } from '@/lib/financeiro/leitura/contas-a-pagar'

let ok = 0, fail = 0
const chk = (c: boolean, m: string) => { if (c) { ok++; console.log('  ✅', m) } else { fail++; console.log('  ❌', m) } }
const TS = Date.now()
const custo = (v: number, venc: Date | null) => criarObrigacaoEconomicaComLedger({ natureza: 'CUSTO', valorContratado: v, moedaContratual: 'BRL', processoId: 16, origemTipo: 'nativo', origemId: null, vencimento: venc })
const dias = (n: number) => new Date(Date.now() + n * 86_400_000)

async function main() {
  const venc = await custo(500, dias(-5))                 // VENCIDA
  const prox = await custo(300, dias(3))                  // PROXIMA
  const pago = await custo(200, dias(10)); await registrarOcorrencia({ obrigacaoId: pago.obrigacaoId, tipo: 'PAGAMENTO', valor: 200, moeda: 'BRL', criadoPorId: 1, idempotencyKey: `pg-${TS}` } as any) // PAGA
  const parc = await custo(400, dias(20)); await registrarOcorrencia({ obrigacaoId: parc.obrigacaoId, tipo: 'PAGAMENTO_PARCIAL', valor: 100, moeda: 'BRL', criadoPorId: 1, idempotencyKey: `pp-${TS}` } as any) // PARCIAL
  const canc = await custo(150, dias(30)); await cancelarObrigacao({ obrigacaoId: canc.obrigacaoId, motivo: 't', criadoPorId: 1 }) // CANCELADA (sai do read-model base)
  const rec = await criarObrigacaoEconomicaComLedger({ natureza: 'RECEITA', valorContratado: 999, moedaContratual: 'BRL', processoId: 16, origemTipo: 'nativo', origemId: null }) // A_RECEBER

  const cp = await listarContasAPagar({ processoId: 16 })
  const bde = (id: number) => cp.itens.find((o) => o.obrigacaoId === id)?.balde

  chk(bde(venc.obrigacaoId) === 'VENCIDA', `custo vencido → VENCIDA (${bde(venc.obrigacaoId)})`)
  chk(bde(prox.obrigacaoId) === 'PROXIMA', `custo em 3d → PROXIMA (${bde(prox.obrigacaoId)})`)
  chk(bde(pago.obrigacaoId) === 'PAGA', `custo quitado → PAGA (${bde(pago.obrigacaoId)})`)
  chk(bde(parc.obrigacaoId) === 'PARCIAL', `custo parcial → PARCIAL (${bde(parc.obrigacaoId)})`)
  chk(bde(canc.obrigacaoId) === undefined, 'custo cancelado sai do read-model padrão')
  chk(bde(rec.obrigacaoId) === undefined, 'Receita (A_RECEBER) NÃO entra em Contas a Pagar')

  chk(cp.baldes.vencidas.qtd >= 1 && cp.baldes.vencidas.totalBrl >= 500, `KPI vencidas ≥ 500 (${cp.baldes.vencidas.totalBrl})`)
  chk(cp.kpis.aPagarBrl >= 500 + 300 + 300, `KPI aPagar soma abertas (${cp.kpis.aPagarBrl})`) // vencida 500 + proxima 300 + parcial saldo 300
  chk(cp.porFornecedor.length >= 1 && cp.porMoeda.some((m) => m.nome === 'BRL'), 'agrupamentos por fornecedor + moeda presentes')

  for (const id of [venc.obrigacaoId, prox.obrigacaoId, pago.obrigacaoId, parc.obrigacaoId, canc.obrigacaoId, rec.obrigacaoId]) {
    await prisma.ocorrenciaFinanceira.deleteMany({ where: { obrigacaoId: id } }).catch(() => {})
    await prisma.$executeRawUnsafe(`DELETE FROM "LedgerEntry" WHERE "ledgerId" IN (SELECT id FROM "LedgerFinanceiro" WHERE "obrigacaoId"=$1)`, id).catch(() => {})
    await prisma.saldoProjecao.deleteMany({ where: { obrigacaoId: id } }); await prisma.ledgerFinanceiro.deleteMany({ where: { obrigacaoId: id } })
    await prisma.domainOutbox.deleteMany({ where: { aggregateType: 'ObrigacaoEconomica', aggregateId: id } })
    await prisma.obrigacaoEconomica.delete({ where: { id } }).catch(() => {})
  }
  console.log(`\n${ok} passaram, ${fail} falharam`)
  await prisma.$disconnect()
  process.exit(fail ? 1 : 0)
}
main().catch((e) => { console.error(e); process.exit(1) })
