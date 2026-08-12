// F3.4 — Validação do CICLO OPERACIONAL do Custo consolidado no motor V3:
// pagamento parcial → estorno → cancelamento, com os indicadores (saldo/recebido em
// listarObrigacoes) conferidos a cada passo. Prova que pagamentos/estornos/cancelamentos
// de custo funcionam pelo motor compartilhado (A_PAGAR), sem legado.
import { prisma } from '@/lib/prisma'
import { criarObrigacaoEconomicaComLedger } from '@/lib/financeiro/ledger/ledger-service'
import { registrarOcorrencia } from '@/lib/financeiro/ocorrencias/ocorrencia-service'
import { cancelarObrigacao } from '@/lib/financeiro/extras/cancelar-lancamento'
import { listarObrigacoes } from '@/lib/financeiro/leitura/consultas'

import { exigirBancoDeTeste } from "./_banco-de-teste"

// TRAVA DE AMBIENTE: este arquivo ESCREVE. Sem banco de teste local, não roda.
exigirBancoDeTeste()

let ok = 0, fail = 0
const chk = (c: boolean, m: string) => { if (c) { ok++; console.log('  ✅', m) } else { fail++; console.log('  ❌', m) } }
const TS = Date.now()

async function ind(PROC: number, obrigacaoId: number) {
  const o = (await listarObrigacoes({ processoId: PROC, natureza: 'CUSTO' })).find((x) => x.obrigacaoId === obrigacaoId)
  return o ? { saldo: Number(o.saldo), recebido: Number(o.recebido) } : null
}

async function main() {
  const PROC = 16
  const { obrigacaoId } = await criarObrigacaoEconomicaComLedger({ natureza: 'CUSTO', valorContratado: 1000, moedaContratual: 'BRL', processoId: PROC, criadoPorId: 1, observacoes: 'Custo ciclo F3.4' })

  const i0 = await ind(PROC, obrigacaoId)
  chk(i0?.saldo === 1000 && i0?.recebido === 0, `inicial: saldo 1000 / pago 0 (${JSON.stringify(i0)})`)

  // pagamento parcial 400 (A_PAGAR: reduz saldo)
  const pay = await registrarOcorrencia({ obrigacaoId, tipo: 'PAGAMENTO_PARCIAL', valor: 400, moeda: 'BRL', criadoPorId: 1, idempotencyKey: `pay-${TS}` } as any)
  chk((pay as any).ocorrenciaId != null, 'pagamento parcial registrado')
  const i1 = await ind(PROC, obrigacaoId)
  chk(i1?.saldo === 600 && i1?.recebido === 400, `após pagamento: saldo 600 / pago 400 (${JSON.stringify(i1)})`)

  // idempotência do pagamento (mesma chave não duplica)
  await registrarOcorrencia({ obrigacaoId, tipo: 'PAGAMENTO_PARCIAL', valor: 400, moeda: 'BRL', criadoPorId: 1, idempotencyKey: `pay-${TS}` } as any).catch(() => {})
  const i1b = await ind(PROC, obrigacaoId)
  chk(i1b?.saldo === 600 && i1b?.recebido === 400, 'idempotência: 2º pagamento com mesma chave não duplica')

  // estorno do pagamento (restaura o SALDO — o net, que dirige "pago" na tela).
  // Nota: `recebido` é o recebidoBruto (não subtrai estorno); o net vai no saldo (=1000).
  await registrarOcorrencia({ obrigacaoId, tipo: 'ESTORNO', valor: 400, moeda: 'BRL', estornaOcorrenciaId: (pay as any).ocorrenciaId, criadoPorId: 1, idempotencyKey: `est-${TS}` } as any)
  const i2 = await ind(PROC, obrigacaoId)
  chk(i2?.saldo === 1000, `após estorno: SALDO restaurado a 1000 (net) — ${JSON.stringify(i2)}`)

  // cancelamento (Ledger reversal; sai das consultas padrão)
  const canc = await cancelarObrigacao({ obrigacaoId, motivo: 'teste F3.4', criadoPorId: 1 })
  chk((canc as any).jaCancelada === false, 'cancelarObrigacao executou')
  const obr = await prisma.obrigacaoEconomica.findUnique({ where: { id: obrigacaoId }, select: { status: true } })
  chk(obr?.status === 'CANCELADO', `status = CANCELADO (${obr?.status})`)
  const i3 = await ind(PROC, obrigacaoId)
  chk(i3 === null, 'custo cancelado SOME das consultas padrão (indicadores)')

  // limpeza
  await prisma.ocorrenciaFinanceira.deleteMany({ where: { obrigacaoId } }).catch(() => {})
  await prisma.$executeRawUnsafe(`DELETE FROM "LedgerEntry" WHERE "ledgerId" IN (SELECT id FROM "LedgerFinanceiro" WHERE "obrigacaoId"=$1)`, obrigacaoId)
  await prisma.saldoProjecao.deleteMany({ where: { obrigacaoId } })
  await prisma.ledgerFinanceiro.deleteMany({ where: { obrigacaoId } })
  await prisma.domainOutbox.deleteMany({ where: { aggregateType: 'ObrigacaoEconomica', aggregateId: obrigacaoId } })
  await prisma.obrigacaoEconomica.delete({ where: { id: obrigacaoId } }).catch(() => {})

  console.log(`\n${ok} passaram, ${fail} falharam`)
  await prisma.$disconnect()
  process.exit(fail ? 1 : 0)
}
main().catch((e) => { console.error(e); process.exit(1) })
