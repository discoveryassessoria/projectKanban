// scripts/charge-calculation.test.ts
// ============================================================================
// GUARDA — ChargeCalculationService: autoridade única do cálculo da Cobrança.
// Cobre os cenários obrigatórios (política de taxas, forma, parcelas, câmbio,
// arredondamento, idempotência, recálculo). Puro: sem banco.
// ============================================================================
import { calcularCobranca, taxaParaCandidata, podeRecalcular, type CobrancaInput } from '../lib/financeiro/charge-calculation-service'
import type { FormaView } from '../lib/financeiro/payment-method-rules'

let passou = 0, falhou = 0
const ok = (n: string, c: boolean) => { if (c) { passou++; console.log(`  ✓ ${n}`) } else { falhou++; console.log(`  ✗ ${n}`) } }
const sec = (t: string) => console.log(`\n${t}`)
const D = new Date('2026-07-01T12:00:00Z')

const forma = (over: Partial<FormaView> = {}): FormaView => ({
  id: 1, name: 'Forma', ativo: true, moedasAceitas: ['BRL'], permiteParcelas: true, minParcelas: 1, maxParcelas: 12,
  exigeAdquirente: false, usoRecebimento: true, usoPagamento: true, aceitaEntrada: true, aceitaRecorrencia: false,
  aceitaMoedaEstrangeira: false, permiteInternacional: false, carteirasCompativeis: [], contasCompativeis: [], ...over,
})
const cond = (over: any = {}) => ({ tipoPagamento: 'PARCELADO', parcelasPadrao: 1, politicaTaxas: 'IGNORAR', aplicaA: 'RECEITA', ...over })
const taxaPct = (over: any = {}) => taxaParaCandidata({ id: 9, name: 'Cartão', feeType: 'percentage', feePercent: 2.99, baseIncidencia: 'TOTAL', ativo: true, prioridade: 0, formasAplicaveis: [], aplicaParcela: 'TODAS', ...over })
const base = (over: Partial<CobrancaInput> = {}): CobrancaInput => ({ aplicaComo: 'RECEBER', valorBase: 100, moeda: 'BRL', dataBase: D, forma: forma(), condicao: cond(), ...over })
const soma = (r: any) => Math.round(r.parcelas.reduce((s: number, p: any) => s + p.valor, 0) * 100) / 100

sec('Cenários obrigatórios')
{
  // 1. PIX à vista BRL sem taxa
  const r1 = calcularCobranca(base({ forma: forma({ name: 'PIX', permiteParcelas: false, maxParcelas: 1 }), condicao: cond({ tipoPagamento: 'AVISTA' }), nParcelas: 1 }))
  ok('1 PIX à vista sem taxa: ok, sem taxa, 1 parcela', r1.ok && r1.valorTaxa === 0 && r1.totalCobrado === 100 && r1.parcelas.length === 1)

  // 2. Cartão 1x taxa ABSORVIDA
  const r2 = calcularCobranca(base({ condicao: cond({ politicaTaxas: 'ABSORVER' }), taxaCandidatas: [taxaPct()], nParcelas: 1 }))
  ok('2 taxa absorvida: total=base, líquido=base-taxa', r2.ok && r2.totalCobrado === 100 && r2.valorTaxa === 2.99 && r2.valorLiquido === 97.01 && r2.valorAbsorvido === 2.99)

  // 3. Cartão 12x taxa REPASSADA com GROSS-UP (total = base / (1 − p))
  //    base 100, p 2,99% → total = 100/0,9701 = 103,08; taxa = 3,08; líquido = base.
  const r3 = calcularCobranca(base({ condicao: cond({ politicaTaxas: 'REPASSAR', parcelasMax: 12 }), taxaCandidatas: [taxaPct()], nParcelas: 12 }))
  ok('3 taxa repassada com gross-up: total=103,08, líquido=100, 12x', r3.ok && r3.totalCobrado === 103.08 && r3.valorLiquido === 100 && r3.valorRepassado === 3.08 && r3.parcelas.length === 12)
  ok('3 soma das parcelas = total (repasse gross-up)', soma(r3) === 103.08)
  ok('3 gross-up confere: total × (1 − 2,99%) ≈ base', Math.abs(r3.totalCobrado * (1 - 0.0299) - 100) < 0.02)

  // 4. 13 parcelas quando o máximo é 12
  const r4 = calcularCobranca(base({ nParcelas: 13 }))
  ok('4 acima do máximo → erro FORMA_MAX_PARCELAS', !r4.ok && r4.erros.some((e) => e.codigo === 'FORMA_MAX_PARCELAS'))

  // 5. Forma incompatível com a moeda
  const r5 = calcularCobranca(base({ moeda: 'USD' }))
  ok('5 forma BRL em cobrança USD → FORMA_INCOMPATIVEL', !r5.ok && r5.erros.some((e) => e.codigo === 'FORMA_INCOMPATIVEL'))

  // 6. Forma exclusiva de recebimento em Conta a Pagar
  const r6 = calcularCobranca(base({ aplicaComo: 'PAGAR', forma: forma({ usoPagamento: false }), condicao: cond({ aplicaA: 'CUSTO' }) }))
  ok('6 forma só-recebimento em pagamento → FORMA_SEM_PAGAMENTO', !r6.ok && r6.erros.some((e) => e.codigo === 'FORMA_SEM_PAGAMENTO'))

  // 7. Política ESCOLHER_NA_COBRANCA sem escolha
  const r7 = calcularCobranca(base({ condicao: cond({ politicaTaxas: 'ESCOLHER_NA_COBRANCA' }), taxaCandidatas: [taxaPct()] }))
  ok('7 ESCOLHER sem escolha → ESCOLHA_TAXA_OBRIGATORIA', !r7.ok && r7.erros.some((e) => e.codigo === 'ESCOLHA_TAXA_OBRIGATORIA'))
  const r7b = calcularCobranca(base({ condicao: cond({ politicaTaxas: 'ESCOLHER_NA_COBRANCA' }), politicaTaxasEscolhida: 'ABSORVER', taxaCandidatas: [taxaPct()], nParcelas: 1 }))
  ok('7b ESCOLHER com ABSORVER resolve', r7b.ok && r7b.politicaTaxas === 'ABSORVER' && r7b.valorAbsorvido === 2.99)

  // 8. Taxa fora da vigência
  const r8 = calcularCobranca(base({ condicao: cond({ politicaTaxas: 'ABSORVER' }), taxaCandidatas: [taxaPct({ vigenciaFim: '2026-01-01' })], nParcelas: 1 }))
  ok('8 taxa vencida não é aplicada', r8.ok && r8.valorTaxa === 0 && r8.taxaAplicada === null)

  // 9. Duas taxas compatíveis sem prioridade (empate)
  const r9 = calcularCobranca(base({ condicao: cond({ politicaTaxas: 'ABSORVER' }), taxaCandidatas: [taxaPct({ id: 9, prioridade: 0 }), taxaPct({ id: 10, name: 'Cartão B', prioridade: 0 })], nParcelas: 1 }))
  ok('9 empate de prioridade → TAXA_AMBIGUA', !r9.ok && r9.erros.some((e) => e.codigo === 'TAXA_AMBIGUA'))
  const r9b = calcularCobranca(base({ condicao: cond({ politicaTaxas: 'ABSORVER' }), taxaCandidatas: [taxaPct({ id: 9, prioridade: 1 }), taxaPct({ id: 10, prioridade: 0 })], nParcelas: 1 }))
  ok('9b prioridade desempata (aplica a maior)', r9b.ok && r9b.taxaAplicada?.id === 9)

  // 10. Entrada + saldo parcelado
  const r10 = calcularCobranca(base({ condicao: cond({ temEntrada: true, entradaTipo: 'PERCENTUAL', percentEntrada: 20, parcelasPadrao: 3, parcelasMax: 12 }), nParcelas: 3 }))
  ok('10 entrada + saldo: soma = total', r10.ok && soma(r10) === 100)

  // 11. Arredondamento de centavos
  const r11 = calcularCobranca(base({ condicao: cond({ parcelasMax: 3 }), nParcelas: 3 }))
  ok('11 100/3 distribui sem perder centavo', soma(r11) === 100 && r11.parcelas.length === 3)

  // 12. Recálculo idempotente
  const inp = base({ condicao: cond({ politicaTaxas: 'REPASSAR', parcelasMax: 6 }), taxaCandidatas: [taxaPct()], nParcelas: 6 })
  const a = calcularCobranca(inp), b = calcularCobranca(inp)
  ok('12 idempotente (mesmos insumos → mesmo resultado)', a.totalCobrado === b.totalCobrado && a.valorTaxa === b.valorTaxa && a.parcelas.length === b.parcelas.length && soma(a) === soma(b))

  // 13. Cobrança paga não pode recalcular
  ok('13 rascunho recalcula; paga/congelada não', podeRecalcular({ status: 'ABERTA' }) && !podeRecalcular({ status: 'PARCIAL' }) && !podeRecalcular({ status: 'ABERTA', temPagamento: true }) && !podeRecalcular({ status: 'ABERTA', congeladaEm: D }))

  // 14/15. Câmbio estimado vs congelado
  const r14 = calcularCobranca(base({ moeda: 'USD', forma: forma({ moedasAceitas: ['USD'], permiteInternacional: true }), cambio: { moedaOrigem: 'EUR', cotacao: 6.1, congelado: false } }))
  ok('14 câmbio estimado na criação', r14.cambio?.estimado === true && r14.cambio?.cotacao === 6.1)
  const r15 = calcularCobranca(base({ moeda: 'USD', forma: forma({ moedasAceitas: ['USD'], permiteInternacional: true }), cambio: { moedaOrigem: 'EUR', cotacao: 6.1, congelado: true } }))
  ok('15 câmbio congelado', r15.cambio?.estimado === false)

  // 16/17/18 — invariantes de líquido
  ok('17 líquido coerente com taxa absorvida', r2.valorLiquido === r2.valorBase - r2.valorTaxa)
  ok('18 líquido preservado com taxa repassada', r3.valorLiquido === r3.valorBase)
}

console.log(`\n${'='.repeat(60)}`)
console.log(`ChargeCalculationService: ${passou} passaram, ${falhou} falharam`)
console.log('='.repeat(60))
if (falhou > 0) process.exit(1)
