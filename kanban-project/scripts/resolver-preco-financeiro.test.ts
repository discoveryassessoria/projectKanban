/**
 * resolverPrecoFinanceiro — testes do NÚCLEO PURO (sem banco), modelo por
 * ESPECIFICIDADE (§2). Rodar: npx tsx scripts/resolver-preco-financeiro.test.ts
 *
 * Cobre: compatibilidade de contexto, especificidade > prioridade > empate,
 * zero silencioso (sem fallback legado), vigência, natureza, per_unit, faixa de
 * quantidade, ambiguidade, wrapper, custo/receita independentes.
 */
import {
  resolverPrecoCore,
  resolverPrecoFinanceiro,
  resolverCustoEReceitaFinanceiro,
  paraCompat,
  type LinhaPreco,
  type ContextoPrecoFinanceiro,
} from '../src/lib/motor/resolver-preco-financeiro'
import { Moeda, NaturezaPreco } from '@prisma/client'

let passed = 0
let failed = 0
const falhas: string[] = []
function ok(cond: boolean, nome: string) {
  if (cond) { passed++; console.log(`  ✅ ${nome}`) } else { failed++; falhas.push(nome); console.log(`  ❌ ${nome}`) }
}

const DATA = new Date('2026-07-14T00:00:00.000Z')
const ITEM = 42

function linha(p: Partial<LinhaPreco> & { id: number; valor: number }): LinhaPreco {
  return {
    moeda: Moeda.EUR, natureza: NaturezaPreco.RECEITA, arquivado: false, prioridade: 0,
    processoId: null, processoTipoId: null, modalidadeId: null, regiao: null, fornecedorId: null,
    quantidadeMinima: null, quantidadeMaxima: null, vigenciaInicio: null, vigenciaFim: null, modoCalculo: 'fixed', ...p,
  }
}
function ctx(over: Partial<ContextoPrecoFinanceiro> = {}): ContextoPrecoFinanceiro {
  return { itemCatalogoId: ITEM, natureza: NaturezaPreco.RECEITA, dataEvento: DATA, ...over }
}

console.log('resolverPrecoFinanceiro — especificidade\n')

// 1) global responde quando só existe global (especificidade 0)
{
  const r = resolverPrecoCore([linha({ id: 1, valor: 90 })], ctx())
  ok(r.ok && r.valor === 90 && r.especificidade === 0 && r.tabelaValorId === 1, '1) global responde (especificidade 0)')
}

// 2) valor 0 NÃO é preço; SEM fallback legado (mesmo passado) → falha
{
  const r = resolverPrecoCore([linha({ id: 1, valor: 0 })], ctx({ fallbackValorPadrao: 150 }))
  ok(!r.ok && r.motivo === 'SEM_PRECO_VALIDO', '2) valor 0 → SEM_PRECO_VALIDO (fallback legado IGNORADO)')
  ok(!r.ok && r.alternativasDescartadas.some((d) => d.motivo === 'valor_zero_ou_negativo'), '2b) zero registrado em descartadas')
}

// 3) especificidade: processo (espec 1) vence global (espec 0)
{
  const linhas = [linha({ id: 1, valor: 90 }), linha({ id: 2, valor: 200, processoId: 7 })]
  const r = resolverPrecoCore(linhas, ctx({ processoId: 7 }))
  ok(r.ok && r.valor === 200 && r.especificidade === 1 && r.tabelaValorId === 2, '3) processo (espec 1) vence global (espec 0)')
  ok(r.ok && r.alternativasDescartadas.some((d) => d.tabelaValorId === 1 && d.motivo === 'menor_especificidade'), '3b) global marcado menor_especificidade')
}

// 4) especificidade acumulativa: tipo+modalidade (espec 2) vence só-tipo (espec 1)
{
  const linhas = [
    linha({ id: 1, valor: 40, processoTipoId: '99' }),
    linha({ id: 2, valor: 55, processoTipoId: '99', modalidadeId: 3 }),
  ]
  const r = resolverPrecoCore(linhas, ctx({ tipoProcessoId: 99, modalidadeId: 3 }))
  ok(r.ok && r.valor === 55 && r.especificidade === 2 && r.tabelaValorId === 2, '4) tipo+modalidade (espec 2) vence só-tipo (espec 1)')
}

// 5) fornecedor específico vence fornecedor vazio quando o contexto tem aquele fornecedor
{
  const linhas = [linha({ id: 1, valor: 90 }), linha({ id: 2, valor: 70, fornecedorId: 5 })]
  const r = resolverPrecoCore(linhas, ctx({ fornecedorId: 5 }))
  ok(r.ok && r.tabelaValorId === 2 && r.especificidade === 1, '5) fornecedor específico vence global (contexto tem o fornecedor)')
}

// 6) incompatível: linha exige fornecedor que o contexto NÃO tem → eliminada
{
  const linhas = [linha({ id: 1, valor: 90 }), linha({ id: 2, valor: 70, fornecedorId: 5 })]
  const r = resolverPrecoCore(linhas, ctx({ fornecedorId: 9 }))
  ok(r.ok && r.tabelaValorId === 1, '6) linha com fornecedor incompatível é eliminada; sobra a global')
  ok(r.ok && r.alternativasDescartadas.some((d) => d.tabelaValorId === 2 && d.motivo === 'incompativel_contexto'), '6b) incompatível registrada')
}

// 7) prioridade só desempata MESMA especificidade
{
  const linhas = [
    linha({ id: 1, valor: 40, processoTipoId: '99', prioridade: 0 }),
    linha({ id: 2, valor: 60, processoTipoId: '99', prioridade: 5 }),
  ]
  const r = resolverPrecoCore(linhas, ctx({ tipoProcessoId: 99 }))
  ok(r.ok && r.valor === 60 && r.prioridade === 5, '7) prioridade desempata mesma especificidade')
}

// 7c) prioridade NÃO supera especificidade
{
  const linhas = [
    linha({ id: 1, valor: 40, processoTipoId: '99', modalidadeId: 3, prioridade: 0 }),
    linha({ id: 2, valor: 60, processoTipoId: '99', prioridade: 9 }),
  ]
  const r = resolverPrecoCore(linhas, ctx({ tipoProcessoId: 99, modalidadeId: 3 }))
  ok(r.ok && r.valor === 40 && r.especificidade === 2, '7c) maior especificidade vence prioridade maior')
}

// 8) empate de especificidade E prioridade com valores divergentes → AMBIGUIDADE
{
  const linhas = [
    linha({ id: 1, valor: 40, processoTipoId: '99', prioridade: 0 }),
    linha({ id: 2, valor: 60, regiao: 'IT', prioridade: 0 }),
  ]
  const r = resolverPrecoCore(linhas, ctx({ tipoProcessoId: 99, regiao: 'IT' }))
  ok(r.ok && r.conflito != null && r.conflito.competidores.length === 1, '8) empate espec+prioridade divergente → conflito (bloqueia)')
}

// 8b) empate de especificidade+prioridade com valores IDÊNTICOS → sem conflito
{
  const linhas = [
    linha({ id: 1, valor: 50, processoTipoId: '99', prioridade: 0 }),
    linha({ id: 2, valor: 50, regiao: 'IT', prioridade: 0 }),
  ]
  const r = resolverPrecoCore(linhas, ctx({ tipoProcessoId: 99, regiao: 'IT' }))
  ok(r.ok && r.conflito == null && r.valor === 50, '8b) empate com valores idênticos não é conflito')
}

// 9) fora de vigência → descartada
{
  const r = resolverPrecoCore([linha({ id: 1, valor: 90, vigenciaFim: '2020-01-01' })], ctx())
  ok(!r.ok && r.alternativasDescartadas.some((d) => d.motivo === 'fora_de_vigencia'), '9) fora de vigência descartada')
}

// 10) natureza divergente ignorada (CUSTO x pedido de VENDA/RECEITA)
{
  const r = resolverPrecoCore([linha({ id: 1, valor: 90, natureza: NaturezaPreco.CUSTO })], ctx({ natureza: NaturezaPreco.VENDA }))
  ok(!r.ok && r.alternativasDescartadas.some((d) => d.motivo === 'natureza_diferente'), '10) natureza divergente ignorada')
}

// 10b) VENDA (pedido) casa linha RECEITA (legado) no lado do PREÇO
{
  const r = resolverPrecoCore([linha({ id: 1, valor: 90, natureza: NaturezaPreco.RECEITA })], ctx({ natureza: NaturezaPreco.VENDA }))
  ok(r.ok && r.valor === 90, '10b) pedir VENDA resolve linha RECEITA (natureza de PREÇO)')
}

// 11) per_unit × quantidade
{
  const r = resolverPrecoCore([linha({ id: 1, valor: 25, modoCalculo: 'per_unit' })], ctx({ quantidade: 3 }))
  ok(r.ok && r.valor === 75 && r.valorUnitario === 25 && r.quantidade === 3, '11) per_unit × quantidade congela unitário')
}

// 12) faixa de quantidade: banda compatível soma especificidade e filtra
{
  const linhas = [
    linha({ id: 1, valor: 90 }),
    linha({ id: 2, valor: 70, quantidadeMinima: 1, quantidadeMaxima: 5 }),
    linha({ id: 3, valor: 60, quantidadeMinima: 6, quantidadeMaxima: 10 }),
  ]
  const r = resolverPrecoCore(linhas, ctx({ quantidade: 3 }))
  ok(r.ok && r.tabelaValorId === 2 && r.especificidade === 1, '12) banda 1-5 casa qtd 3 (espec 1); banda 6-10 eliminada')
}

// 13) sem linhas → NENHUMA_LINHA (sem fallback)
{
  const r = resolverPrecoCore([], ctx({ fallbackValorPadrao: 120 }))
  ok(!r.ok && r.motivo === 'NENHUMA_LINHA', '13) vazio → NENHUMA_LINHA (fallback ignorado)')
}

// 14) moeda divergente sinalizada
{
  const r = resolverPrecoCore([linha({ id: 1, valor: 90, moeda: Moeda.EUR })], ctx({ moeda: Moeda.BRL }))
  ok(r.ok && r.moedaDivergente === true && r.moeda === Moeda.EUR, '14) moeda divergente sinalizada')
}

// 15) NaN/Infinity não são preços válidos
{
  ok(!resolverPrecoCore([linha({ id: 1, valor: NaN })], ctx()).ok, '15) NaN não é preço válido')
  ok(!resolverPrecoCore([linha({ id: 1, valor: Infinity })], ctx()).ok, '15b) Infinity não é preço válido')
}

// 16) desempate determinístico: vigência mais recente, depois id
{
  const linhas = [
    linha({ id: 1, valor: 80, vigenciaInicio: '2026-01-01' }),
    linha({ id: 2, valor: 95, vigenciaInicio: '2026-06-01' }),
  ]
  const r = resolverPrecoCore(linhas, ctx())
  ok(r.ok && r.tabelaValorId === 2, '16) desempate: vigência mais recente vence')
}

// 17) paraCompat
{
  const c = paraCompat(resolverPrecoCore([linha({ id: 7, valor: 90 })], ctx()))
  ok(c != null && c.valor === 90 && c.tabelaValorId === 7, '17) paraCompat devolve shape legado')
  ok(paraCompat(resolverPrecoCore([], ctx())) === null, '17b) paraCompat null quando não resolve')
}

async function assíncronos() {
  // 18) wrapper valida item e resolve via loader injetado
  const carregar = async () => [linha({ id: 1, valor: 90 })]
  const bad = await resolverPrecoFinanceiro({ itemCatalogoId: 0, natureza: NaturezaPreco.RECEITA, dataEvento: DATA }, carregar)
  ok(!bad.ok && bad.motivo === 'ITEM_INVALIDO', '18) wrapper rejeita itemCatalogoId inválido')
  const good = await resolverPrecoFinanceiro({ itemCatalogoId: ITEM, natureza: NaturezaPreco.RECEITA, dataEvento: DATA }, carregar)
  ok(good.ok && good.valor === 90, '18b) wrapper resolve via loader injetado')

  // 19) custo e receita resolvidos independentes
  const carregar2 = async (_item: number, nat: NaturezaPreco | null | undefined) =>
    nat === NaturezaPreco.CUSTO ? [linha({ id: 1, valor: 150, moeda: Moeda.BRL, natureza: NaturezaPreco.CUSTO })]
      : [linha({ id: 2, valor: 90, moeda: Moeda.EUR, natureza: NaturezaPreco.RECEITA })]
  const r = await resolverCustoEReceitaFinanceiro({ itemCatalogoId: ITEM, dataEvento: DATA }, carregar2)
  ok(r.custo.ok && r.custo.valor === 150 && r.custo.moeda === Moeda.BRL, '19) custo independente')
  ok(r.receita.ok && r.receita.valor === 90 && r.receita.moeda === Moeda.EUR, '19b) receita independente')
}

assíncronos().then(() => {
  console.log(`\n=== ${passed} passaram, ${failed} falharam ===`)
  if (failed) { console.log('FALHAS:', falhas.join('; ')); process.exit(1) }
})
