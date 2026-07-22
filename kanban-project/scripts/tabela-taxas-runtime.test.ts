// scripts/tabela-taxas-runtime.test.ts
// GUARDA — Tabela de Taxas como fonte de cálculo no runtime: resolução ciente de
// BANDEIRA + grade por parcela + política ABSORVER. Puro (usa o serviço).
import { calcularCobranca, taxaParaCandidata, type CobrancaInput } from '../lib/financeiro/charge-calculation-service'
import type { FormaView } from '../lib/financeiro/payment-method-rules'

let passou = 0, falhou = 0
const ok = (n: string, c: boolean) => { if (c) { passou++; console.log(`  ✓ ${n}`) } else { falhou++; console.log(`  ✗ ${n}`) } }
const sec = (t: string) => console.log(`\n${t}`)
const D = new Date('2026-07-01T12:00:00Z')

const cartao: FormaView = { id: 30, name: 'Cartão de Crédito', ativo: true, moedasAceitas: ['BRL'], permiteParcelas: true, minParcelas: 1, maxParcelas: 12, exigeAdquirente: false, usoRecebimento: true, usoPagamento: false, aceitaEntrada: false, aceitaRecorrencia: false, aceitaMoedaEstrangeira: false, permiteInternacional: false, carteirasCompativeis: [], contasCompativeis: [] }
const condCartaoAbsorver = { tipoPagamento: 'PARCELADO', parcelasPadrao: 1, parcelasMax: 12, politicaTaxas: 'ABSORVER', aplicaA: 'RECEITA' }

// taxas da tabela: Visa (bandeiraId 1) e Mastercard (bandeiraId 2) com grades.
const gradeVisa = [3.25, 5.67, 6.69, 7.09, 7.70, 8.07, 8.92, 9.60, 10.22, 10.58, 11.06, 11.60]
const gradeElo = [3.80, 6.32, 7.34, 7.74, 8.35, 8.72, 9.57, 10.25, 10.87, 11.23, 11.71, 12.25]
const taxaCartao = (id: number, bandeiraId: number, grade: number[]) => taxaParaCandidata({
  id, name: `Crédito bandeira ${bandeiraId}`, feeType: 'percentage', feePercent: grade[0], ativo: true, prioridade: 0,
  formasAplicaveis: [30], bandeiraId, aplicaParcela: 'TODAS',
  parcelamento: grade.map((p, i) => ({ parcelasDe: i + 1, parcelasAte: i + 1, feePercent: p })),
})
const cands = [taxaCartao(1, 1, gradeVisa), taxaCartao(2, 3, gradeElo)] // 1=Visa, 3=Elo

const base = (over: Partial<CobrancaInput> = {}): CobrancaInput => ({ aplicaComo: 'RECEBER', valorBase: 1000, moeda: 'BRL', dataBase: D, forma: cartao, condicao: condCartaoAbsorver as any, taxaCandidatas: cands, ...over })

sec('1 — resolução por bandeira')
{
  const visa6 = calcularCobranca(base({ bandeiraId: 1, nParcelas: 6 }))
  ok('Visa 6x → 8,07% (grade), ABSORVER', visa6.ok && visa6.valorTaxa === 80.7 && visa6.totalCobrado === 1000 && visa6.valorLiquido === 919.3)
  const elo6 = calcularCobranca(base({ bandeiraId: 3, nParcelas: 6 }))
  ok('Elo 6x → 8,72% (grade diferente)', elo6.ok && elo6.valorTaxa === 87.2)
  ok('bandeiras dão taxas diferentes na mesma parcela', visa6.valorTaxa !== elo6.valorTaxa)
}

sec('2 — grade por parcela (mesma bandeira)')
{
  const v1 = calcularCobranca(base({ bandeiraId: 1, nParcelas: 1 }))
  const v12 = calcularCobranca(base({ bandeiraId: 1, nParcelas: 12 }))
  ok('Visa 1x → 3,25%', v1.valorTaxa === 32.5)
  ok('Visa 12x → 11,60% (grade)', v12.valorTaxa === 116)
}

sec('3 — sem bandeira: taxa específica não se aplica (evita ambiguidade)')
{
  const semBandeira = calcularCobranca(base({ nParcelas: 6 })) // bandeiraId undefined
  ok('sem bandeira → nenhuma taxa de bandeira aplicada (0)', semBandeira.ok && semBandeira.valorTaxa === 0 && semBandeira.taxaAplicada === null)
  ok('duas bandeiras não geram TAXA_AMBIGUA (desempate por bandeira)', calcularCobranca(base({ bandeiraId: 1, nParcelas: 6 })).ok)
}

sec('4 — IGNORAR não aplica taxa mesmo com candidatas')
{
  const ign = calcularCobranca(base({ bandeiraId: 1, nParcelas: 6, condicao: { ...condCartaoAbsorver, politicaTaxas: 'IGNORAR' } as any }))
  ok('política IGNORAR → total = base, taxa 0', ign.valorTaxa === 0 && ign.totalCobrado === 1000)
}

console.log(`\n${'='.repeat(60)}`)
console.log(`Tabela de Taxas (runtime): ${passou} passaram, ${falhou} falharam`)
console.log('='.repeat(60))
if (falhou > 0) process.exit(1)
