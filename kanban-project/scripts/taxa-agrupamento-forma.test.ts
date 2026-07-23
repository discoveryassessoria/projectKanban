// scripts/taxa-agrupamento-forma.test.ts
// GUARDA — Agrupamento das taxas POR FORMA DE PAGAMENTO (camada de apresentação).
// Uma linha por forma; bandeira/adquirente/parcela ficam dentro. Cobre §10/§19.
import { agruparTaxasPorForma, type TaxaParaAgrupar } from '../lib/financeiro/taxa-identidade'

let passou = 0, falhou = 0
const ok = (n: string, c: boolean) => { if (c) { passou++; console.log(`  ✓ ${n}`) } else { falhou++; console.log(`  ✗ ${n}`) } }
const sec = (t: string) => console.log(`\n${t}`)

const formas = [
  { id: 30, name: 'Cartão de Crédito', code: 'FPG-1', type: 'CARTAO_CREDITO', ativo: true },
  { id: 31, name: 'Cartão de Débito', code: 'FPG-2', type: 'CARTAO_DEBITO', ativo: true },
  { id: 40, name: 'Boleto', code: 'FPG-3', type: 'BOLETO', ativo: true },
  { id: 10, name: 'PIX', code: 'FPG-4', type: 'PIX', ativo: true },
  { id: 11, name: 'Wise', code: 'FPG-5', type: 'WISE', ativo: true },
]
const nomeAdq = (id: number) => (id === 1 ? 'Cielo' : null)
const nomeBand = (id: number) => ({ 1: 'Visa', 2: 'Mastercard', 3: 'Elo', 4: 'American Express', 5: 'Diners' } as Record<number, string>)[id] ?? null

const gradeVisa = [3.25, 5.67, 6.69, 7.09, 7.70, 8.07, 8.92, 9.60, 10.22, 10.58, 11.06, 11.60]
const credito = (id: number, band: number, grade: number[]): TaxaParaAgrupar => ({
  id, formasAplicaveis: [30], adquirenteId: 1, bandeiraId: band, ativo: true,
  parcelamento: grade.map((p, i) => ({ parcelasDe: i + 1, parcelasAte: i + 1, feePercent: p, fixedFee: null })),
})
const taxas: TaxaParaAgrupar[] = [
  credito(1, 1, gradeVisa), credito(2, 2, gradeVisa), credito(3, 3, gradeVisa), credito(4, 4, gradeVisa),
  credito(5, 5, [3.25]), // Diners só 1x
  { id: 6, formasAplicaveis: [31], adquirenteId: 1, bandeiraId: 1, feePercent: 0.86, ativo: true, parcelamento: [] },
  { id: 7, formasAplicaveis: [31], adquirenteId: 1, bandeiraId: 3, feePercent: 1.41, ativo: true, parcelamento: [] },
  { id: 8, formasAplicaveis: [40], finalidade: 'EMISSAO', fixedFee: 5, ativo: true, parcelamento: [] },
  { id: 9, formasAplicaveis: [40], finalidade: 'PAGAMENTO', fixedFee: 5, ativo: true, parcelamento: [] },
  { id: 10, formasAplicaveis: [10], feePercent: 0, ativo: true, parcelamento: [] },
  { id: 11, formasAplicaveis: [11], feePercent: 1.5, ativo: true, parcelamento: [] },
]

const grupos = agruparTaxasPorForma(taxas, formas, nomeAdq, nomeBand)
const por = (id: number) => grupos.find((g) => g.formaPagamentoId === id)!

sec('1 — uma linha por forma (não por bandeira/parcela)')
{
  ok('5 formas agrupadas', grupos.length === 5)
  ok('Cartão de Crédito aparece UMA vez', grupos.filter((g) => g.formaPagamentoId === 30).length === 1)
  ok('nenhuma linha "Cartão de Crédito — Visa"', !grupos.some((g) => g.nome.includes('—')))
}

sec('2 — Cartão de Crédito: resumo')
{
  const c = por(30)
  ok('tipo GRADE', c.tipoTaxa === 'GRADE')
  ok('5 bandeiras', c.quantidadeBandeiras === 5)
  ok('1 adquirente (Cielo)', c.quantidadeAdquirentes === 1 && c.adquirentesNomes[0] === 'Cielo')
  ok('parcelas 1x–12x', c.parcelasMin === 1 && c.parcelasMax === 12)
  ok('bandeiras nomeadas', c.bandeirasNomes.includes('Visa') && c.bandeirasNomes.includes('Diners'))
}

sec('3 — Débito: taxa única, uma linha')
{
  const d = por(31)
  ok('tipo PERCENTUAL', d.tipoTaxa === 'PERCENTUAL')
  ok('pagamento único (1x)', d.parcelasMin === 1 && d.parcelasMax === 1)
  ok('2 bandeiras (Visa/Elo)', d.quantidadeBandeiras === 2)
}

sec('4 — Boleto: uma linha com encargos (emissão+liquidação juntos)')
{
  const b = por(40)
  ok('tipo ENCARGOS', b.tipoTaxa === 'ENCARGOS')
  ok('possui encargos', b.possuiEncargos === true)
  ok('2 configurações (emissão+liquidação) numa linha', b.quantidadeConfiguracoes === 2)
}

sec('5 — PIX e Wise: uma linha cada, taxa única')
{
  ok('PIX uma linha', por(10).quantidadeConfiguracoes === 1 && por(10).tipoTaxa === 'PERCENTUAL')
  ok('Wise uma linha', por(11).quantidadeConfiguracoes === 1)
}

console.log(`\n${'='.repeat(60)}`)
console.log(`Agrupamento por forma: ${passou} passaram, ${falhou} falharam`)
console.log('='.repeat(60))
if (falhou > 0) process.exit(1)
