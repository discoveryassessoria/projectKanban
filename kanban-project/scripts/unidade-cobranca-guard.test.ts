/**
 * Unidade de cobrança — GUARDA de paridade com o enum oficial e da separação
 * estratégia × unidade. Rodar: npx tsx scripts/unidade-cobranca-guard.test.ts
 */
import { UnidadeItem } from '@prisma/client'
import { UNIDADES_COBRANCA, normalizarUnidade, unidadeValida, rotuloUnidade, rotuloUnidadeMinuscula } from '../lib/financeiro/unidade-cobranca'
import { estrategiaDoModo, modoDaEstrategia, ESTRATEGIA, estrategiaUsaPrimeiroAdicional, estrategiaUsaFaixaQuantidade, modoMultiplicaQuantidade, modoCalculoValido } from '../lib/financeiro/modo-calculo'

let passed = 0, failed = 0
const falhas: string[] = []
const ok = (n: string, c: boolean) => { if (c) { passed++; console.log(`  ✅ ${n}`) } else { failed++; falhas.push(n); console.log(`  ❌ ${n}`) } }

console.log('\nParidade com enum oficial UnidadeItem')
{
  const oficiais = new Set(Object.values(UnidadeItem) as string[])
  const nossas = new Set(UNIDADES_COBRANCA as readonly string[])
  ok('mesma cardinalidade', oficiais.size === nossas.size)
  ok('toda unidade nossa existe no enum', [...nossas].every((u) => oficiais.has(u)))
  ok('todo valor do enum está na nossa lista', [...oficiais].every((u) => nossas.has(u)))
}

console.log('\nNormalização e rótulos')
{
  ok('REQUERENTE válido', unidadeValida('REQUERENTE'))
  ok('lowercase normaliza (documento→DOCUMENTO)', normalizarUnidade('documento') === 'DOCUMENTO')
  ok('inválida → null', normalizarUnidade('xpto') === null)
  ok('vazia → null', normalizarUnidade('') === null && normalizarUnidade(null) === null)
  ok('rótulo Página', rotuloUnidade('PAGINA') === 'Página')
  ok('rótulo minúsculo "documento"', rotuloUnidadeMinuscula('DOCUMENTO') === 'documento')
}

console.log('\nEstratégia × unidade são ORTOGONAIS')
{
  // A estratégia vem só do modoCalculo; a unidade é independente.
  ok('modoDaEstrategia(unitario) = per_unit', modoDaEstrategia('unitario') === ESTRATEGIA.POR_UNIDADE)
  ok('modoDaEstrategia(primeiro_adicional) = first_additional', modoDaEstrategia('primeiro_adicional') === ESTRATEGIA.PRIMEIRO_ADICIONAL)
  ok('modoDaEstrategia(faixa) = quantity_range', modoDaEstrategia('faixa') === ESTRATEGIA.FAIXA)
  ok('modoDaEstrategia(fixo) = fixed', modoDaEstrategia('fixo') === ESTRATEGIA.FIXO)

  // as 4 estratégias canônicas são válidas e classificam certo
  ok('per_unit → unitario', estrategiaDoModo('per_unit') === 'unitario')
  ok('first_additional → primeiro_adicional', estrategiaDoModo('first_additional') === 'primeiro_adicional')
  ok('quantity_range → faixa', estrategiaDoModo('quantity_range') === 'faixa')
  ok('fixed → fixo', estrategiaDoModo('fixed') === 'fixo')

  // FAIXA agora é uma estratégia real (min/max ativos)
  ok('faixa usa min/max', estrategiaUsaFaixaQuantidade('quantity_range') === true)
  ok('por unidade NÃO usa base/adicional', estrategiaUsaPrimeiroAdicional('per_unit') === false)
  ok('primeiro+adic usa base/adicional', estrategiaUsaPrimeiroAdicional('first_additional') === true)

  // engine: tudo multiplica menos fixo (inclui os códigos NOVOS)
  ok('per_unit multiplica', modoMultiplicaQuantidade('per_unit'))
  ok('quantity_range multiplica', modoMultiplicaQuantidade('quantity_range'))
  ok('first_additional multiplica', modoMultiplicaQuantidade('first_additional'))
  ok('fixed NÃO multiplica', !modoMultiplicaQuantidade('fixed'))

  // validade aceita canônicos e legados
  ok('modoCalculoValido(per_unit)', modoCalculoValido('per_unit'))
  ok('modoCalculoValido(quantity_range)', modoCalculoValido('quantity_range'))
  ok('modoCalculoValido(per_document legado)', modoCalculoValido('per_document'))
  ok('modoCalculoValido(xpto)=false', !modoCalculoValido('xpto'))
}

console.log(`\n${'='.repeat(56)}`)
console.log(`Unidade de cobrança: ${passed} passaram, ${failed} falharam`)
if (falhas.length) console.log('Falhas:\n  - ' + falhas.join('\n  - '))
console.log('='.repeat(56))
if (failed > 0) process.exit(1)
