// scripts/taxas-encargos.test.ts
// ============================================================================
// Motores de TAXAS (lib/financeiro/taxas-pagamento) e ENCARGOS
// (lib/financeiro/encargos-financeiros). Puros: não precisam de banco.
// ============================================================================
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { calcularTaxas, taxaAplicavel, type TaxaView } from '../lib/financeiro/taxas-pagamento'
import { calcularEncargos, diferencaEmDias } from '../lib/financeiro/encargos-financeiros'

const RAIZ = join(__dirname, '..')
let passou = 0
let falhou = 0
function ok(nome: string, cond: boolean, detalhe = '') {
  if (cond) { passou++; console.log(`  ✓ ${nome}`) }
  else { falhou++; console.log(`  ✗ ${nome}${detalhe ? ` — ${detalhe}` : ''}`) }
}
function eq(nome: string, a: unknown, b: unknown) {
  ok(nome, Object.is(a, b) || JSON.stringify(a) === JSON.stringify(b), `esperado ${JSON.stringify(b)}, veio ${JSON.stringify(a)}`)
}
function secao(t: string) { console.log(`\n${t}`) }

const HOJE = new Date('2026-07-21T12:00:00Z')

// ── TAXAS ───────────────────────────────────────────────────────────────────
secao('Taxa percentual')
{
  const t: TaxaView = { id: 1, nome: 'Cartão', tipo: 'PERCENTUAL', percentual: 3.5, adquirente: 'Stone' }
  const r = calcularTaxas([t], { valorBruto: 1000, nParcelas: 1, emDatas: HOJE })
  eq('valor bruto preservado', r.valorBruto, 1000)
  eq('taxa de 3,5%', r.valorTaxas, 35)
  eq('líquido = bruto − taxa', r.valorLiquido, 965)
  eq('uma linha', r.linhas.length, 1)
  eq('adquirente registrado', r.linhas[0].adquirente, 'Stone')
  ok('memória cita a fórmula', r.memoria.some((m) => m.includes('3.5%')))
}

secao('Taxa fixa e tarifa bancária')
{
  const fixa = calcularTaxas([{ id: 2, nome: 'Tarifa', tipo: 'FIXA', valorFixo: 4.9 }], { valorBruto: 1000, nParcelas: 3, emDatas: HOJE })
  eq('fixa cobrada uma vez', fixa.valorTaxas, 4.9)

  const porParcela = calcularTaxas(
    [{ id: 3, nome: 'Boleto', tipo: 'TARIFA_BANCARIA', valorFixo: 3.5, baseIncidencia: 'PARCELA' }],
    { valorBruto: 900, nParcelas: 3, emDatas: HOJE },
  )
  eq('tarifa por parcela × 3', porParcela.valorTaxas, 10.5)
  eq('líquido desconta as 3 tarifas', porParcela.valorLiquido, 889.5)
}

secao('Taxa por parcela (percentual)')
{
  const r = calcularTaxas(
    [{ id: 4, nome: 'Antecip.', tipo: 'PERCENTUAL', percentual: 1, baseIncidencia: 'PARCELA' }],
    { valorBruto: 900, nParcelas: 3, emDatas: HOJE },
  )
  eq('1% sobre cada parcela de 300', r.valorTaxas, 9)
}

secao('Percentual + fixa')
{
  const r = calcularTaxas(
    [{ id: 5, nome: 'Gateway', tipo: 'PERCENTUAL_MAIS_FIXA', percentual: 2, valorFixo: 0.39 }],
    { valorBruto: 1000, nParcelas: 1, emDatas: HOJE },
  )
  eq('2% + 0,39', r.valorTaxas, 20.39)
}

secao('Quem absorve a taxa')
{
  const cliente = calcularTaxas(
    [{ id: 6, nome: 'Repasse', tipo: 'PERCENTUAL', percentual: 5, quemAbsorve: 'CLIENTE' }],
    { valorBruto: 1000, nParcelas: 1, emDatas: HOJE },
  )
  eq('repassada não reduz o líquido', cliente.valorLiquido, 1000)
  eq('registrada como repasse', cliente.valorTaxasRepassadas, 50)
  eq('não entra em valorTaxas', cliente.valorTaxas, 0)

  const empresa = calcularTaxas(
    [{ id: 7, nome: 'Absorvida', tipo: 'PERCENTUAL', percentual: 5, quemAbsorve: 'EMPRESA' }],
    { valorBruto: 1000, nParcelas: 1, emDatas: HOJE },
  )
  eq('absorvida reduz o líquido', empresa.valorLiquido, 950)
}

secao('Aplicabilidade da taxa')
{
  const base = { valorBruto: 1000, nParcelas: 6, emDatas: HOJE }
  ok('sem restrição aplica', taxaAplicavel({ id: 1 }, base))
  ok('inativa não aplica', !taxaAplicavel({ id: 1, ativo: false }, base))
  ok('dentro da faixa de parcelas', taxaAplicavel({ id: 1, parcelasDe: 2, parcelasAte: 12 }, base))
  ok('abaixo da faixa não aplica', !taxaAplicavel({ id: 1, parcelasDe: 7 }, base))
  ok('acima da faixa não aplica', !taxaAplicavel({ id: 1, parcelasAte: 3 }, base))
  ok('fora de vigência não aplica', !taxaAplicavel({ id: 1, vigenciaFim: '2026-01-01' }, base))
  ok('dentro da vigência aplica', taxaAplicavel({ id: 1, vigenciaInicio: '2026-01-01', vigenciaFim: '2026-12-31' }, base))

  const r = calcularTaxas([{ id: 1, tipo: 'PERCENTUAL', percentual: 10, ativo: false }], base)
  eq('taxa inativa não entra no cálculo', r.valorTaxas, 0)
}

secao('Múltiplas taxas somam')
{
  const r = calcularTaxas(
    [
      { id: 1, nome: 'Cartão', tipo: 'PERCENTUAL', percentual: 3 },
      { id: 2, nome: 'Tarifa', tipo: 'FIXA', valorFixo: 5 },
    ],
    { valorBruto: 1000, nParcelas: 1, emDatas: HOJE },
  )
  eq('duas linhas', r.linhas.length, 2)
  eq('soma das taxas', r.valorTaxas, 35)
  eq('líquido', r.valorLiquido, 965)
}

// ── ENCARGOS ────────────────────────────────────────────────────────────────
secao('Momento GERACAO — descontos')
{
  const avista = calcularEncargos({
    regras: { descontoAVistaPercent: 10 }, base: 1000, momento: 'GERACAO', nParcelas: 1, dataEvento: HOJE,
  })
  eq('desconto à vista aplicado', avista.descontos, 100)
  eq('valor a cobrar', avista.valorACobrar, 900)

  const parcelado = calcularEncargos({
    regras: { descontoAVistaPercent: 10 }, base: 1000, momento: 'GERACAO', nParcelas: 3, dataEvento: HOJE,
  })
  eq('à vista NÃO se aplica a parcelado', parcelado.descontos, 0)
  eq('valor íntegro', parcelado.valorACobrar, 1000)

  const comercial = calcularEncargos({
    regras: { descontoPercent: 5 }, base: 1000, momento: 'GERACAO', nParcelas: 3, dataEvento: HOJE,
  })
  eq('desconto comercial vale em qualquer parcelamento', comercial.descontos, 50)
}

secao('Momento PAGAMENTO — multa e juros')
{
  const emDia = calcularEncargos({
    regras: { multaPercent: 2, jurosMesPercent: 1 }, base: 1000, momento: 'PAGAMENTO',
    vencimento: '2026-07-21', dataEvento: HOJE,
  })
  eq('sem atraso: nada é cobrado', emDia.acrescimos, 0)
  eq('dias de atraso zero', emDia.diasAtraso, 0)

  const atrasado = calcularEncargos({
    regras: { multaPercent: 2, jurosMesPercent: 1 }, base: 1000, momento: 'PAGAMENTO',
    vencimento: '2026-06-21', dataEvento: HOJE,
  })
  eq('30 dias de atraso', atrasado.diasAtraso, 30)
  eq('multa de 2% uma vez', atrasado.linhas.find((l) => l.tipo === 'MULTA')?.valor, 20)
  eq('juros 1%/mês por 30 dias', atrasado.linhas.find((l) => l.tipo === 'JUROS')?.valor, 10)
  eq('acréscimos somados', atrasado.acrescimos, 30)
  eq('valor a cobrar', atrasado.valorACobrar, 1030)

  const meioMes = calcularEncargos({
    regras: { jurosMesPercent: 2 }, base: 1000, momento: 'PAGAMENTO',
    vencimento: '2026-07-06', dataEvento: HOJE,
  })
  eq('juros pro-rata 15 dias', meioMes.linhas.find((l) => l.tipo === 'JUROS')?.valor, 10)
}

secao('Momento ANTECIPACAO')
{
  const ant = calcularEncargos({
    regras: { descontoAntecipacaoPercent: 2 }, base: 1000, momento: 'ANTECIPACAO',
    vencimento: '2026-08-20', dataEvento: HOJE,
  })
  eq('30 dias de antecipação', ant.diasAntecipacao, 30)
  eq('desconto de 2% ao mês', ant.descontos, 20)
  eq('valor a cobrar', ant.valorACobrar, 980)

  const semAntecipar = calcularEncargos({
    regras: { descontoAntecipacaoPercent: 2 }, base: 1000, momento: 'ANTECIPACAO',
    vencimento: '2026-07-21', dataEvento: HOJE,
  })
  eq('sem antecipação, sem desconto', semAntecipar.descontos, 0)
}

secao('Momento VENCIMENTO e RENEGOCIACAO')
{
  const venc = calcularEncargos({
    regras: { multaPercent: 2, jurosMesPercent: 1 }, base: 1000, momento: 'VENCIMENTO',
    vencimento: '2026-06-21', dataEvento: HOJE,
  })
  eq('VENCIMENTO não cobra nada', venc.acrescimos, 0)
  eq('base preservada', venc.valorACobrar, 1000)

  const reneg = calcularEncargos({
    regras: { multaPercent: 2, jurosMesPercent: 1 }, base: 1000, momento: 'RENEGOCIACAO',
    vencimento: '2026-06-21', dataEvento: HOJE,
  })
  eq('RENEGOCIACAO congela multa+juros', reneg.acrescimos, 30)
}

secao('Garantias gerais')
{
  eq('diferença em dias', diferencaEmDias(new Date('2026-07-01T00:00:00'), new Date('2026-07-21T00:00:00')), 20)

  const semRegras = calcularEncargos({ regras: {}, base: 1000, momento: 'PAGAMENTO', vencimento: '2026-01-01', dataEvento: HOJE })
  eq('sem regras declaradas, nada incide', semRegras.valorACobrar, 1000)

  const negativo = calcularEncargos({ regras: { descontoPercent: 150 }, base: 100, momento: 'GERACAO', nParcelas: 1, dataEvento: HOJE })
  ok('valor a cobrar nunca fica negativo', negativo.valorACobrar >= 0)

  const memoria = calcularEncargos({ regras: { multaPercent: 2 }, base: 500, momento: 'PAGAMENTO', vencimento: '2026-06-01', dataEvento: HOJE })
  ok('memória de cálculo preenchida', memoria.memoria.length >= 3)
  ok('memória cita o valor a cobrar', memoria.memoria.some((m) => m.includes('Valor a cobrar')))
}

// ── GUARDAS DE INTEGRAÇÃO ───────────────────────────────────────────────────
secao('Integração com o FinanceRuleEngine')
{
  const ap = readFileSync(join(RAIZ, 'lib/financeiro/aplicar-condicao.ts'), 'utf8')
  ok('aplica cronograma', ap.includes('gerarCronograma'))
  ok('aplica taxas', ap.includes('calcularTaxas'))
  ok('aplica encargos de geração', ap.includes("momento: 'GERACAO'"))
  ok('congela memória de cálculo', ap.includes('memoriaCalculo'))
  ok('rateia taxa entre parcelas', ap.includes('valorTaxa'))

  for (const f of ['src/lib/motor/executor.ts', 'src/lib/motor/matriz-economica.ts']) {
    const src = readFileSync(join(RAIZ, f), 'utf8')
    ok(`${f} usa o ponto único`, src.includes('aplicarCondicaoPagamento'))
    ok(`${f} persiste a condição aplicada`, src.includes('condicaoPagamentoId: ap.campos.condicaoPagamentoId'))
    ok(`${f} persiste valor líquido`, src.includes('valorLiquido: ap.campos.valorLiquido'))
    ok(`${f} não monta parcelamento na mão`, !src.includes('gerarParcelas'))
  }

  const schema = readFileSync(join(RAIZ, 'prisma/schema.prisma'), 'utf8')
  for (const campo of ['condicaoPagamentoId', 'condicaoVersao', 'valorBruto', 'valorTaxas', 'valorLiquido', 'memoriaCalculo']) {
    ok(`schema tem ${campo}`, schema.includes(campo))
  }
  ok('parcela marca entrada', /model ParcelaFinanceira[\s\S]*?entrada\s+Boolean/.test(schema))
  ok('taxa tem quemAbsorve', /model TaxaPagamento[\s\S]*?quemAbsorve/.test(schema))

  const mig = readFileSync(join(RAIZ, 'prisma/migrations/20260726000000_pagamentos_taxas_encargos/migration.sql'), 'utf8')
  ok('migration é aditiva', !/DROP\s+(TABLE|COLUMN)|TRUNCATE|DELETE FROM/i.test(mig))
  ok('migration adiciona condição na Receita', mig.includes('"Receita" ADD COLUMN "condicaoPagamentoId"'))
  ok('migration adiciona condição no Custo', mig.includes('"Custo" ADD COLUMN "condicaoPagamentoId"'))
}

console.log(`\n${'='.repeat(60)}`)
console.log(`Taxas e Encargos: ${passou} passaram, ${falhou} falharam`)
console.log('='.repeat(60))
if (falhou > 0) process.exit(1)
