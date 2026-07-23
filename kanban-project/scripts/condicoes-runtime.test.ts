// scripts/condicoes-runtime.test.ts
// GUARDA — Módulo de Condições de Pagamento (runtime PURO): entrada como
// componente à parte SEM taxa, taxa só sobre o saldo, cronograma por mês de
// calendário, encargos de boleto por evento. Cobre os cenários 1–7 da spec.
import { calcularCobranca, taxaParaCandidata, type CobrancaInput } from '../lib/financeiro/charge-calculation-service'
import { gerarCronograma, calcularValorEntrada } from '../lib/financeiro/condicao-pagamento'
import { encargosBoletoNoEvento } from '../lib/financeiro/encargos-boleto'
import type { FormaView } from '../lib/financeiro/payment-method-rules'

let passou = 0, falhou = 0
const ok = (n: string, c: boolean) => { if (c) { passou++; console.log(`  ✓ ${n}`) } else { falhou++; console.log(`  ✗ ${n}`) } }
const sec = (t: string) => console.log(`\n${t}`)
const iso = (d: Date) => d.toISOString().slice(0, 10)
const D = new Date('2026-07-01T12:00:00Z')

// ── formas ──
const forma = (id: number, name: string, over: Partial<FormaView> = {}): FormaView => ({
  id, name, ativo: true, moedasAceitas: ['BRL'], permiteParcelas: false, minParcelas: 1, maxParcelas: 1,
  exigeAdquirente: false, usoRecebimento: true, usoPagamento: false, aceitaEntrada: false, aceitaRecorrencia: false,
  aceitaMoedaEstrangeira: false, permiteInternacional: false, carteirasCompativeis: [], contasCompativeis: [], ...over,
})
const PIX = forma(10, 'PIX')
const CARTAO = forma(30, 'Cartão de Crédito', { permiteParcelas: true, maxParcelas: 12, aceitaEntrada: true })
const BOLETO = forma(40, 'Boleto', { permiteParcelas: true, maxParcelas: 12, aceitaEntrada: true })

// ── condições (3 lógicas) ──
const cAvista = { id: 1, codigo: 'COND-AVISTA', nome: 'À Vista', tipoPagamento: 'AVISTA', parcelasMin: 1, parcelasMax: 1, politicaTaxas: 'ABSORVER', aplicaA: 'RECEITA', temEntrada: false, formasPermitidasIds: [10, 40, 20, 50, 60] }
const cCartao = { id: 2, codigo: 'COND-CARTAO-CREDITO', nome: 'Cartão de Crédito', tipoPagamento: 'PARCELADO', parcelasMin: 1, parcelasMax: 12, politicaTaxas: 'ABSORVER', aplicaA: 'RECEITA', temEntrada: true, formasPermitidasIds: [30], periodicidade: 'MENSAL', inicioCronograma: 'IMEDIATA' }
const cBoleto = { id: 3, codigo: 'COND-BOLETO', nome: 'Boleto Parcelado', tipoPagamento: 'PARCELADO', parcelasMin: 1, parcelasMax: 12, politicaTaxas: 'IGNORAR', aplicaA: 'RECEITA', temEntrada: true, formasPermitidasIds: [40], periodicidade: 'MENSAL', inicioCronograma: 'IMEDIATA', multaPercent: 2, jurosMesPercent: 1, carenciaDias: 3 }

// ── taxas de crédito (tabela) ──
const gVisa = [3.25, 5.67, 6.69, 7.09, 7.70, 8.07, 8.92, 9.60, 10.22, 10.58, 11.06, 11.60]
const gElo = [3.80, 6.32, 7.34, 7.74, 8.35, 8.72, 9.57, 10.25, 10.87, 11.23, 11.71, 12.25]
const gAmex = [3.75, 6.27, 7.29, 7.69, 8.30, 8.67, 9.52, 10.20, 10.82, 11.18, 11.66, 12.20]
const taxaCartao = (id: number, bandeiraId: number, g: number[]) => taxaParaCandidata({
  id, name: `Crédito ${bandeiraId}`, feeType: 'percentage', feePercent: g[0], ativo: true, prioridade: 0,
  formasAplicaveis: [30], bandeiraId, aplicaParcela: 'TODAS',
  parcelamento: g.map((p, i) => ({ parcelasDe: i + 1, parcelasAte: i + 1, feePercent: p })),
})
const cartoes = [taxaCartao(1, 1, gVisa), taxaCartao(2, 3, gElo), taxaCartao(3, 4, gAmex)]

const base = (o: Partial<CobrancaInput> = {}): CobrancaInput => ({ aplicaComo: 'RECEBER', valorBase: 1000, moeda: 'BRL', dataBase: D, forma: CARTAO, condicao: cCartao as any, taxaCandidatas: cartoes, ...o })

// ══════════════════════════════════════════════════════════════════════════
sec('Cenário 1 — À Vista PIX R$1.000: pagamento único sem taxa')
{
  const r = calcularCobranca(base({ forma: PIX, condicao: cAvista as any, nParcelas: 1, taxaCandidatas: [] }))
  ok('ok, 1 parcela, sem taxa', r.ok && r.nParcelas === 1 && r.valorTaxa === 0 && r.totalCobrado === 1000)
  ok('parcela única não é entrada', r.parcelas.length === 1 && !r.parcelas[0].entrada)
}

sec('Cenário 1b — À Vista bloqueia 2x e entrada e cartão de crédito')
{
  const r2 = calcularCobranca(base({ forma: PIX, condicao: cAvista as any, nParcelas: 2, taxaCandidatas: [] }))
  ok('2x bloqueado na À Vista', !r2.ok)
  // A condição, isolada, também colapsa a quantidade para 1 (cronograma puro).
  const cron1 = gerarCronograma(cAvista as any, { total: 1000, dataBase: D, nParcelas: 2 })
  ok('condição À Vista força 1 parcela (cronograma)', cron1.parcelas.length === 1)
  const rEnt = calcularCobranca(base({ forma: PIX, condicao: cAvista as any, nParcelas: 1, entradaValor: 300, taxaCandidatas: [] }))
  ok('entrada bloqueada (condição não permite)', !rEnt.ok && rEnt.erros.some((e) => e.codigo === 'ENTRADA_NAO_PERMITIDA'))
  const rCred = calcularCobranca(base({ forma: CARTAO, condicao: cAvista as any, nParcelas: 1, taxaCandidatas: [] }))
  ok('cartão de crédito não permitido na À Vista', !rCred.ok && rCred.erros.some((e) => e.codigo === 'FORMA_NAO_PERMITIDA'))
}

sec('Cenário 2 — Cartão Visa 6x R$1.000 → 8,07% ABSORVER')
{
  const r = calcularCobranca(base({ bandeiraId: 1, nParcelas: 6 }))
  ok('Visa 6x = 8,07% → taxa 80,70', r.ok && r.valorTaxa === 80.7)
  ok('ABSORVER: total 1000, líquido 919,30', r.totalCobrado === 1000 && r.valorLiquido === 919.3)
  ok('Elo 6x = 8,72% → 87,20', calcularCobranca(base({ bandeiraId: 3, nParcelas: 6 })).valorTaxa === 87.2)
  ok('Amex 12x = 12,20% → 122,00', calcularCobranca(base({ bandeiraId: 4, nParcelas: 12 })).valorTaxa === 122)
  ok('13x bloqueado (forma máx 12)', !calcularCobranca(base({ bandeiraId: 1, nParcelas: 13 })).ok)
}

sec('Cenário 3 — R$10.000, entrada R$2.000 PIX, saldo R$8.000, Visa 6x')
{
  const r = calcularCobranca(base({ valorBase: 10000, entradaValor: 2000, bandeiraId: 1, nParcelas: 6 }))
  ok('taxa só sobre o saldo 8.000 × 8,07% = 645,60', r.ok && r.valorTaxa === 645.6)
  const entrada = r.parcelas.find((p) => p.entrada)!
  ok('entrada = 2.000, sem taxa', entrada && entrada.valor === 2000 && entrada.valorTaxa === 0)
  ok('saldo em 6 parcelas + 1 entrada = 7 componentes', r.parcelas.length === 7 && r.parcelas.filter((p) => !p.entrada).length === 6)
  ok('soma das parcelas = total 10.000', Math.round(r.parcelas.reduce((s, p) => s + p.valor, 0)) === 10000)
  ok('taxa distribuída só no saldo (entrada zero)', r.parcelas.filter((p) => p.entrada).every((p) => p.valorTaxa === 0))
}

sec('Cenário 4 — Boleto 12x R$12.000 por mês de calendário (data-base 31/01)')
{
  const cron = gerarCronograma(cBoleto as any, { total: 12000, dataBase: new Date('2026-01-31T12:00:00Z'), nParcelas: 12 })
  ok('12 parcelas de 1.000', cron.parcelas.length === 12 && cron.parcelas.every((p) => p.valor === 1000))
  ok('1ª parcela na data-base 31/01', iso(cron.parcelas[0].vencimento) === '2026-01-31')
  ok('fevereiro usa último dia (28/02, ano não bissexto 2026)', iso(cron.parcelas[1].vencimento) === '2026-02-28')
  ok('março volta a 31 (sem drift)', iso(cron.parcelas[2].vencimento) === '2026-03-31')
  ok('abril usa 30 (mês curto)', iso(cron.parcelas[3].vencimento) === '2026-04-30')
  ok('não soma 30 dias repetidos (maio = 31/05)', iso(cron.parcelas[4].vencimento) === '2026-05-31')
}

sec('Cenário 4b — fevereiro bissexto (2028, data-base 31/01)')
{
  const cron = gerarCronograma(cBoleto as any, { total: 6000, dataBase: new Date('2028-01-31T12:00:00Z'), nParcelas: 3 })
  ok('fev bissexto = 29/02/2028', iso(cron.parcelas[1].vencimento) === '2028-02-29')
}

sec('Cenário 5 — R$12.000, entrada 20% Transferência (2.400), Boleto 10x')
{
  const entrada = calcularValorEntrada({ temEntrada: true, percentEntrada: 20 } as any, 12000)
  ok('entrada 20% = 2.400', entrada === 2400)
  const cron = gerarCronograma(cBoleto as any, { total: 12000, dataBase: D, nParcelas: 10, entradaValor: 2400 })
  ok('entrada + 10 boletos = 11 componentes', cron.parcelas.length === 11)
  const saldo = cron.parcelas.filter((p) => !p.entrada).reduce((s, p) => s + p.valor, 0)
  ok('saldo dos boletos = 9.600', Math.round(saldo) === 9600)
  ok('entrada marcada e sem encargo de boleto', cron.parcelas[0].entrada && cron.parcelas[0].valor === 2400)
}

sec('Cenário 6 — boleto 2 dias de atraso: sem multa (carência 3), juros pro-rata')
{
  const e = encargosBoletoNoEvento({ base: 1000, liquidado: false, diasAtraso: 2 }, { multaPercent: 2, carenciaMultaDias: 3, jurosMesPercent: 1 })
  ok('sem multa dentro da carência', e.multa === 0)
  ok('juros = 1000 × (1%/30) × 2 = 0,67', e.juros === 0.67)
  ok('liquidação NÃO antecipada (boleto não pago)', e.taxaLiquidacao === 0)
}

sec('Cenário 7 — boleto 4 dias de atraso: multa 2% + juros simples, sem capitalização')
{
  const e = encargosBoletoNoEvento({ base: 1000, diasAtraso: 4 }, { multaPercent: 2, carenciaMultaDias: 3, jurosMesPercent: 1 })
  ok('multa 2% = 20,00', e.multa === 20)
  ok('juros simples 4 dias = 1,33 (sem capitalizar)', e.juros === 1.33)
  ok('total encargos = 21,33', e.totalEncargos === 21.33)
}

sec('Encargos por evento — emissão só na emissão, liquidação só no pagamento')
{
  const naEmissao = encargosBoletoNoEvento({ base: 1000, emitido: true, liquidado: false })
  ok('emissão R$5 quando emitido', naEmissao.taxaEmissao === 5 && naEmissao.taxaLiquidacao === 0)
  const noPagamento = encargosBoletoNoEvento({ base: 1000, emitido: true, liquidado: true })
  ok('liquidação R$5 só no pagamento', noPagamento.taxaLiquidacao === 5)
  const planejado = encargosBoletoNoEvento({ base: 1000, emitido: false, liquidado: false })
  ok('planejado: nada aplicado', planejado.taxaEmissao === 0 && planejado.taxaLiquidacao === 0 && planejado.multa === 0 && planejado.juros === 0)
}

sec('Gerais — entrada ≥ total bloqueada; snapshot congela a regra; taxa vem da tabela')
{
  const rMaior = calcularCobranca(base({ valorBase: 1000, entradaValor: 1000, bandeiraId: 1, nParcelas: 6 }))
  ok('entrada = total → erro', !rMaior.ok && rMaior.erros.some((e) => e.codigo === 'ENTRADA_MAIOR_TOTAL'))
  const r = calcularCobranca(base({ bandeiraId: 1, nParcelas: 6 }))
  const snap = r.snapshot as any
  ok('snapshot congela código/versão/nome da condição', snap.condicao?.codigo === 'COND-CARTAO-CREDITO' && snap.condicao?.parcelasEscolhidas === 6)
  ok('sem bandeira → taxa não resolve (evita ambiguidade)', calcularCobranca(base({ nParcelas: 6 })).valorTaxa === 0)
}

console.log(`\n${'='.repeat(60)}`)
console.log(`Condições (runtime): ${passou} passaram, ${falhou} falharam`)
console.log('='.repeat(60))
if (falhou > 0) process.exit(1)
