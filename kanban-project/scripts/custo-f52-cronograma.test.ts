// F5.2 — Cronograma de PAGÁVEIS (ParcelaPagavel). O status de pagamento é DERIVADO do
// Ledger (recebido acumulado), nunca armazenado. Valida soma=valor, idempotência,
// transações e cancelamento de parcela. Não toca ParcelaFinanceira (recebíveis).
import { prisma } from '@/lib/prisma'
import { criarObrigacaoEconomicaComLedger } from '@/lib/financeiro/ledger/ledger-service'
import { registrarOcorrencia } from '@/lib/financeiro/ocorrencias/ocorrencia-service'
import { definirCronogramaPagavel, cancelarParcelaPagavel, parcelasPagaveisComStatus } from '@/lib/financeiro/pagavel/cronograma-pagavel'

import { exigirBancoDeTeste } from "./_banco-de-teste"

// TRAVA DE AMBIENTE: este arquivo ESCREVE. Sem banco de teste local, não roda.
exigirBancoDeTeste()

let ok = 0, fail = 0
const chk = (c: boolean, m: string) => { if (c) { ok++; console.log('  ✅', m) } else { fail++; console.log('  ❌', m) } }
const TS = Date.now(); const dias = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString()
const st = async (id: number) => (await parcelasPagaveisComStatus(id)).map((p) => p.status)

async function main() {
  const { obrigacaoId: c } = await criarObrigacaoEconomicaComLedger({ natureza: 'CUSTO', valorContratado: 1000, moedaContratual: 'BRL', processoId: 16, origemTipo: 'nativo', origemId: null })

  // validação de soma: 3x100 ≠ 1000 → rejeita
  let rejeitou = false
  try { await definirCronogramaPagavel(c, [{ vencimento: dias(10), valor: 100 }, { vencimento: dias(40), valor: 100 }, { vencimento: dias(70), valor: 100 }]) } catch { rejeitou = true }
  chk(rejeitou, 'soma das parcelas ≠ valor da obrigação → REJEITADO (não duplica cálculo)')

  // define 300 / 300 / 400 = 1000
  const r = await definirCronogramaPagavel(c, [{ vencimento: dias(10), valor: 300 }, { vencimento: dias(40), valor: 300 }, { vencimento: dias(70), valor: 400 }], { usuarioId: 1 })
  chk(r.criadas === 3, `cronograma criado com 3 parcelas (${r.criadas})`)
  chk(JSON.stringify(await st(c)) === JSON.stringify(['PENDENTE', 'PENDENTE', 'PENDENTE']), 'todas PENDENTE (nada pago ainda)')

  // idempotência
  const r2 = await definirCronogramaPagavel(c, [{ vencimento: dias(10), valor: 1000 }])
  chk(r2.jaExistia && r2.criadas === 0, 'idempotente: 2ª definição não recria')

  // pagamento 300 (Ledger) → parcela 1 PAGA (status DERIVADO)
  await registrarOcorrencia({ obrigacaoId: c, tipo: 'PAGAMENTO_PARCIAL', valor: 300, moeda: 'BRL', criadoPorId: 1, idempotencyKey: `p1-${TS}` } as any)
  chk(JSON.stringify(await st(c)) === JSON.stringify(['PAGA', 'PENDENTE', 'PENDENTE']), 'pago 300 → parcela 1 PAGA (derivado do Ledger)')

  // pagamento +400 (700 total) → parcela 2 PAGA, parcela 3 PARCIAL
  await registrarOcorrencia({ obrigacaoId: c, tipo: 'PAGAMENTO_PARCIAL', valor: 400, moeda: 'BRL', criadoPorId: 1, idempotencyKey: `p2-${TS}` } as any)
  chk(JSON.stringify(await st(c)) === JSON.stringify(['PAGA', 'PAGA', 'PARCIAL']), 'pago 700 → 1 PAGA, 2 PAGA, 3 PARCIAL')

  // cancelar parcela 3 (só o plano; Ledger intacto)
  await cancelarParcelaPagavel(c, 3, { usuarioId: 1 })
  chk((await st(c))[2] === 'CANCELADA', 'parcela 3 cancelada → CANCELADA')
  const proj = await prisma.saldoProjecao.findUnique({ where: { obrigacaoId: c } })
  chk(proj != null, 'Ledger/projeção intactos após cancelar parcela (saldo não vive na parcela)')

  // auditoria do cronograma
  chk((await prisma.logAuditoria.count({ where: { entidade: 'ObrigacaoEconomica', entidadeId: c, acao: 'CRONOGRAMA_PAGAVEL' } })) >= 2, 'auditoria do cronograma registrada (definir + cancelar)')

  // limpeza
  await prisma.parcelaPagavel.deleteMany({ where: { obrigacaoId: c } })
  await prisma.logAuditoria.deleteMany({ where: { entidade: 'ObrigacaoEconomica', entidadeId: c } }).catch(() => {})
  await prisma.ocorrenciaFinanceira.deleteMany({ where: { obrigacaoId: c } }).catch(() => {})
  await prisma.$executeRawUnsafe(`DELETE FROM "LedgerEntry" WHERE "ledgerId" IN (SELECT id FROM "LedgerFinanceiro" WHERE "obrigacaoId"=$1)`, c).catch(() => {})
  await prisma.saldoProjecao.deleteMany({ where: { obrigacaoId: c } }); await prisma.ledgerFinanceiro.deleteMany({ where: { obrigacaoId: c } })
  await prisma.domainOutbox.deleteMany({ where: { aggregateType: 'ObrigacaoEconomica', aggregateId: c } })
  await prisma.obrigacaoEconomica.delete({ where: { id: c } }).catch(() => {})

  console.log(`\n${ok} passaram, ${fail} falharam`)
  await prisma.$disconnect()
  process.exit(fail ? 1 : 0)
}
main().catch((e) => { console.error(e); process.exit(1) })
