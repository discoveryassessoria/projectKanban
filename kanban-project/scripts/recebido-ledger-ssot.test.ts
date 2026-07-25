// scripts/recebido-ledger-ssot.test.ts
// Regressão do bug: pagamento V3 (Ledger) baixado, mas parcela NÃO virada → tela
// mostrava "Recebido R$0 / A VENCER". Fix: Ledger é a fonte única de recebido; quando
// o razão tem movimento ele manda; parcela quitada só cobre legado sem lançamento.
// Roda: npx tsx scripts/recebido-ledger-ssot.test.ts
import { computeCambioAging } from '@/lib/financeiro/leitura/cambio-aging'

let ok = 0, fail = 0
const eq = (n: string, a: unknown, b: unknown) => { if (JSON.stringify(a) === JSON.stringify(b)) ok++; else { fail++; console.error(`✗ ${n}: esperado ${JSON.stringify(b)}, obtido ${JSON.stringify(a)}`) } }

const FX = 6.1006
const live = { rates: {}, data: null }
const rec = { fxRule: 'VARIAVEL', fxFixo: null, fxEstimado: FX, valorBrlFixo: null, fxData: null } as any
const AGORA = new Date('2026-07-25').getTime()
const parcela = (status: string, valor: number, venc: string) => ({ status, valor, valorBrl: null, cambioAplicado: null, vencimento: venc } as any)
const base = { moedaBase: 'EUR', valorBase: 1800, vencimento: '2026-08-01', receita: rec, live, agora: AGORA }
const contratadoBrl = 10981.08 // cent(1800 * 6.1006)

// 1) V3: razão pagou tudo (1800), parcela continua PENDENTE → recebido = contratado, QUITADO
{
  const r = computeCambioAging({ ...base, saldoLedger: 0, recebidoLedger: 1800, parcelas: [parcela('PENDENTE', 1800, '2026-08-01')] })
  eq('V3 pago: recebidoBrl = contratado', r.recebidoBrl, contratadoBrl)
  eq('V3 pago: saldoBrl = 0', r.saldoBrl, 0)
  eq('V3 pago: status QUITADO', r.statusLabel, 'QUITADO')
  eq('V3 pago: 1 parcela recebida (cobertura)', r.parcelasRecebidas, 1)
}

// 2) Sem pagamento (razão 0), parcela PENDENTE → recebido 0, A VENCER
{
  const r = computeCambioAging({ ...base, saldoLedger: 1800, recebidoLedger: 0, parcelas: [parcela('PENDENTE', 1800, '2026-08-01')] })
  eq('sem pag: recebidoBrl 0', r.recebidoBrl, 0)
  eq('sem pag: saldoBrl = contratado', r.saldoBrl, contratadoBrl)
  eq('sem pag: status A VENCER', r.statusLabel, 'A VENCER')
}

// 3) LEGADO: razão 0, parcela RECEBIDA → fallback usa a parcela (não regride)
{
  const r = computeCambioAging({ ...base, saldoLedger: 1800, recebidoLedger: 0, parcelas: [parcela('RECEBIDA', 1800, '2026-08-01')] })
  eq('legado: recebidoBrl = contratado (parcela)', r.recebidoBrl, contratadoBrl)
  eq('legado: status QUITADO', r.statusLabel, 'QUITADO')
}

// 4) Parcial via razão (900 de 1800), parcela PENDENTE → PARCIAL
{
  const r = computeCambioAging({ ...base, saldoLedger: 900, recebidoLedger: 900, parcelas: [parcela('PENDENTE', 900, '2026-08-01'), parcela('PENDENTE', 900, '2026-09-01')] })
  eq('parcial: recebidoBrl = metade', r.recebidoBrl, 5490.54)
  eq('parcial: saldoBrl = metade', r.saldoBrl, 5490.54)
  eq('parcial: status PARCIAL', r.statusLabel, 'PARCIAL')
  eq('parcial: 1 parcela coberta', r.parcelasRecebidas, 1)
}

// 5) BRL puro: razão manda igual
{
  const r = computeCambioAging({ moedaBase: 'BRL', valorBase: 1000, vencimento: '2026-08-01', receita: null, live, agora: AGORA, saldoLedger: 400, recebidoLedger: 600, parcelas: [parcela('PENDENTE', 1000, '2026-08-01')] })
  eq('BRL: recebidoBrl 600', r.recebidoBrl, 600)
  eq('BRL: saldoBrl 400', r.saldoBrl, 400)
  eq('BRL: status PARCIAL', r.statusLabel, 'PARCIAL')
}

console.log(`\n${fail === 0 ? '✅' : '❌'} recebido-ledger-ssot: ${ok} ok, ${fail} falhas`)
process.exit(fail === 0 ? 0 : 1)
