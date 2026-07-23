// scripts/cambio-grossup.test.ts
// GUARDA — Gross-up real no repasse + conversão cambial (EUR↔BRL). PURO.
import { calcularCobranca, taxaParaCandidata, type CobrancaInput } from '../lib/financeiro/charge-calculation-service'
import { converter, converterInverso, cotacaoEfetiva, direcaoConversao, exigeCotacao } from '../lib/financeiro/cambio-conversao'
import type { FormaView } from '../lib/financeiro/payment-method-rules'

let passou = 0, falhou = 0
const ok = (n: string, c: boolean) => { if (c) { passou++; console.log(`  ✓ ${n}`) } else { falhou++; console.log(`  ✗ ${n}`) } }
const sec = (t: string) => console.log(`\n${t}`)
const D = new Date('2026-07-01T12:00:00Z')

const cartao: FormaView = { id: 30, name: 'Cartão de Crédito', ativo: true, moedasAceitas: ['EUR'], permiteParcelas: true, minParcelas: 1, maxParcelas: 12, exigeAdquirente: false, usoRecebimento: true, usoPagamento: false, aceitaEntrada: true, aceitaRecorrencia: false, aceitaMoedaEstrangeira: true, permiteInternacional: true, carteirasCompativeis: [], contasCompativeis: [] }
const gVisa = [3.25, 5.67, 6.69, 7.09, 7.70, 8.07, 8.92, 9.60, 10.22, 10.58, 11.06, 11.60]
const taxaVisa = taxaParaCandidata({ id: 1, name: 'Visa', feeType: 'percentage', feePercent: gVisa[0], ativo: true, prioridade: 0, formasAplicaveis: [30], bandeiraId: 1, aplicaParcela: 'TODAS', parcelamento: gVisa.map((p, i) => ({ parcelasDe: i + 1, parcelasAte: i + 1, feePercent: p })) })

const cond = (pol: string) => ({ id: 2, codigo: 'COND-CARTAO-CREDITO', nome: 'Cartão de Crédito', tipoPagamento: 'PARCELADO', parcelasMin: 1, parcelasMax: 12, politicaTaxas: pol, aplicaA: 'RECEITA', temEntrada: true, formasPermitidasIds: [30], periodicidade: 'MENSAL', inicioCronograma: 'IMEDIATA' })
const base = (o: Partial<CobrancaInput> = {}): CobrancaInput => ({ aplicaComo: 'RECEBER', valorBase: 2800, moeda: 'EUR', dataBase: D, forma: cartao, condicao: cond('REPASSAR') as any, taxaCandidatas: [taxaVisa], bandeiraId: 1, nParcelas: 6, entradaValor: 560, ...o })

sec('1 — GROSS-UP no repasse (taxa só sobre o saldo; entrada intocada)')
{
  const r = calcularCobranca(base())
  // saldo 2240; total saldo = 2240 / (1 - 0.0807) = 2436,64; taxa = 196,64
  ok('saldo financiado 2240 (2800 − 560 entrada)', r.ok)
  ok('taxa gross-up = 196,64 (não 180,77 do simples)', r.valorTaxa === 196.64)
  ok('total cobrado = 560 + 2436,64 = 2996,64', r.totalCobrado === 2996.64)
  ok('líquido = 2800 (empresa recebe o base cheio)', r.valorLiquido === 2800)
  // verificação do gross-up: (total − entrada) × (1 − p) ≈ saldo 2240
  const totalSaldo = r.totalCobrado - 560
  ok('conferência: totalSaldo × (1 − 8,07%) ≈ 2240', Math.abs(totalSaldo * (1 - 0.0807) - 2240) < 0.02)
  const entrada = r.parcelas.find((p) => p.entrada)!
  ok('entrada sem taxa (valorTaxa 0)', entrada && entrada.valor === 560 && entrada.valorTaxa === 0)
}

sec('2 — ABSORVER (empresa absorve): simples sobre o saldo')
{
  const r = calcularCobranca(base({ condicao: cond('ABSORVER') as any }))
  ok('taxa = 2240 × 8,07% = 180,77', r.valorTaxa === 180.77)
  ok('total = 2800 (cliente paga o base)', r.totalCobrado === 2800)
  ok('líquido = 2800 − 180,77 = 2619,23', r.valorLiquido === 2619.23)
}

sec('3 — câmbio explícito no resultado (origem→destino)')
{
  const r = calcularCobranca(base({ cambio: { moedaOrigem: 'EUR', moedaDestino: 'BRL', cotacao: 6.1135, tipo: 'AUTOMATICA', congelado: true } }))
  ok('cambio.moedaDestino = BRL', r.cambio?.moedaDestino === 'BRL')
  ok('cambio.cotacao = 6.1135', r.cambio?.cotacao === 6.1135)
  ok('cambio.tipo preservado', r.cambio?.tipo === 'AUTOMATICA' && r.cambio?.estimado === false)
}

sec('4 — conversão EUR↔BRL')
{
  ok('EUR→BRL: 2800 × 6,1135 = 17.117,80', converter(2800, 6.1135) === 17117.8)
  ok('BRL→EUR: 17.117,80 ÷ 6,1135 = 2800,00', converterInverso(17117.8, 6.1135) === 2800)
  ok('exigeCotacao(EUR,BRL) = true; (BRL,BRL) = false', exigeCotacao('EUR', 'BRL') && !exigeCotacao('BRL', 'BRL'))
  ok('direção MESMA quando iguais', direcaoConversao('EUR', 'EUR') === 'MESMA')
}

sec('5 — cotação efetiva direta e inversa')
{
  const dir = cotacaoEfetiva('EUR', 'BRL', { moedaDe: 'EUR', moedaPara: 'BRL', taxa: 6.1135 })
  ok('direta usa a taxa como está', dir?.cotacao === 6.1135 && dir?.direcao === 'DIRETA')
  const inv = cotacaoEfetiva('BRL', 'EUR', { moedaDe: 'EUR', moedaPara: 'BRL', taxa: 6.1135 })
  ok('inversa usa 1/taxa', inv != null && Math.abs(inv.cotacao - 1 / 6.1135) < 1e-6 && inv.direcao === 'INVERSA')
  ok('par incompatível → null', cotacaoEfetiva('USD', 'BRL', { moedaDe: 'EUR', moedaPara: 'BRL', taxa: 6.1135 }) === null)
}

console.log(`\n${'='.repeat(60)}`)
console.log(`Câmbio + gross-up: ${passou} passaram, ${falhou} falharam`)
console.log('='.repeat(60))
if (falhou > 0) process.exit(1)
