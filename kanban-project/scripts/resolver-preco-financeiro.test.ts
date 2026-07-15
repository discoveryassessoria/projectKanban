/**
 * resolverPrecoFinanceiro — testes do NÚCLEO PURO (sem banco).
 * Rodar: npx tsx scripts/resolver-preco-financeiro.test.ts
 *
 * Cobre os requisitos da Fase 7 e os bugs B1/B2 da auditoria:
 * precedência, zero silencioso, vigência, natureza, per_unit, fallback,
 * alternativas descartadas, moeda divergente.
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
  if (cond) {
    passed++
    console.log(`  ✅ ${nome}`)
  } else {
    failed++
    falhas.push(nome)
    console.log(`  ❌ ${nome}`)
  }
}

const DATA = new Date('2026-07-14T00:00:00.000Z')
const ITEM = 42

function linha(p: Partial<LinhaPreco> & { id: number; valor: number }): LinhaPreco {
  return {
    moeda: Moeda.EUR,
    natureza: NaturezaPreco.RECEITA,
    arquivado: false,
    processoId: null,
    processoTipoId: null,
    regiao: null,
    fornecedorId: null,
    vigenciaInicio: null,
    vigenciaFim: null,
    modoCalculo: 'fixed',
    ...p,
  }
}

function ctx(over: Partial<ContextoPrecoFinanceiro> = {}): ContextoPrecoFinanceiro {
  return { itemCatalogoId: ITEM, natureza: NaturezaPreco.RECEITA, dataEvento: DATA, ...over }
}

console.log('resolverPrecoFinanceiro — núcleo puro\n')

// 1) Global responde quando só existe global
{
  const r = resolverPrecoCore([linha({ id: 1, valor: 90 })], ctx())
  ok(r.ok && r.valor === 90 && r.nivel === 'global' && r.prioridade === 5, '1) global responde com valor correto')
}

// 2) B2 — global com valor 0 NÃO vira preço; cai no fallback explícito
{
  const r = resolverPrecoCore([linha({ id: 1, valor: 0 })], ctx({ fallbackValorPadrao: 150, fallbackMoeda: Moeda.BRL }))
  ok(r.ok && r.valor === 150 && r.nivel === 'fallback_padrao', '2) valor 0 ignorado, usa fallback explícito')
  ok(r.ok && r.alternativasDescartadas.some((d) => d.motivo === 'valor_zero_ou_negativo'), '2b) zero registrado em descartadas')
}

// 3) B2 — global 0 e SEM fallback → falha clara, nunca zero silencioso
{
  const r = resolverPrecoCore([linha({ id: 1, valor: 0 })], ctx())
  ok(!r.ok && r.motivo === 'SEM_PRECO_VALIDO', '3) zero sem fallback → SEM_PRECO_VALIDO (nunca contabiliza 0)')
}

// 4) Precedência: processo vence global
{
  const linhas = [linha({ id: 1, valor: 90 }), linha({ id: 2, valor: 200, processoId: 7 })]
  const r = resolverPrecoCore(linhas, ctx({ processoId: 7 }))
  ok(r.ok && r.valor === 200 && r.nivel === 'processo' && r.tabelaValorId === 2, '4) processo específico vence global')
  ok(r.ok && r.alternativasDescartadas.some((d) => d.tabelaValorId === 1 && d.motivo === 'perdeu_precedencia'), '4b) global marcado perdeu_precedencia')
}

// 5) Precedência completa: tipoProcesso > regiao > fornecedor > global
{
  const linhas = [
    linha({ id: 1, valor: 10 }), // global
    linha({ id: 2, valor: 20, fornecedorId: 5 }),
    linha({ id: 3, valor: 30, regiao: 'IT' }),
    linha({ id: 4, valor: 40, processoTipoId: '99' }),
  ]
  const r = resolverPrecoCore(linhas, ctx({ tipoProcessoId: 99, regiao: 'IT', fornecedorId: 5 }))
  ok(r.ok && r.nivel === 'tipoProcesso' && r.valor === 40, '5) tipoProcesso vence regiao/fornecedor/global')
}

// 6) Vigência: linha fora da janela é descartada
{
  const linhas = [linha({ id: 1, valor: 90, vigenciaInicio: '2027-01-01' })]
  const r = resolverPrecoCore(linhas, ctx())
  ok(!r.ok && r.alternativasDescartadas.some((d) => d.motivo === 'fora_de_vigencia'), '6) fora de vigência descartada')
}

// 7) Natureza diferente é ignorada
{
  const linhas = [linha({ id: 1, valor: 90, natureza: NaturezaPreco.CUSTO })]
  const r = resolverPrecoCore(linhas, ctx({ natureza: NaturezaPreco.RECEITA }))
  ok(!r.ok && r.alternativasDescartadas.some((d) => d.motivo === 'natureza_diferente'), '7) natureza divergente ignorada')
}

// 8) per_unit multiplica pela quantidade
{
  const linhas = [linha({ id: 1, valor: 25, modoCalculo: 'per_unit' })]
  const r = resolverPrecoCore(linhas, ctx({ quantidade: 3 }))
  ok(r.ok && r.valor === 75 && r.valorUnitario === 25, '8) per_unit × quantidade')
}

// 9) Sem linhas + fallback → usa fallback
{
  const r = resolverPrecoCore([], ctx({ fallbackValorPadrao: 120 }))
  ok(r.ok && r.nivel === 'fallback_padrao' && r.valor === 120, '9) sem linhas usa fallback')
}

// 10) Sem linhas + sem fallback → NENHUMA_LINHA
{
  const r = resolverPrecoCore([], ctx())
  ok(!r.ok && r.motivo === 'NENHUMA_LINHA', '10) vazio sem fallback → NENHUMA_LINHA')
}

// 11) Moeda divergente sinalizada (sem conversão)
{
  const linhas = [linha({ id: 1, valor: 90, moeda: Moeda.EUR })]
  const r = resolverPrecoCore(linhas, ctx({ moeda: Moeda.BRL }))
  ok(r.ok && r.moedaDivergente === true && r.moeda === Moeda.EUR, '11) moeda divergente sinalizada, devolve moeda da linha')
}

// 12) fallback com valor 0 NÃO é usado
{
  const r = resolverPrecoCore([], ctx({ fallbackValorPadrao: 0 }))
  ok(!r.ok, '12) fallback 0 não é preço válido')
}

// 15) Desempate determinístico dentro do nível: vigência mais recente vence
{
  const linhas = [
    linha({ id: 1, valor: 80, vigenciaInicio: '2026-01-01' }),
    linha({ id: 2, valor: 95, vigenciaInicio: '2026-06-01' }),
  ]
  const r = resolverPrecoCore(linhas, ctx())
  ok(r.ok && r.valor === 95 && r.tabelaValorId === 2, '15) desempate: vigência mais recente vence')
  ok(r.ok && r.alternativasDescartadas.some((d) => d.tabelaValorId === 1 && d.motivo === 'perdeu_precedencia'), '15b) perdedor do desempate registrado')
}

// 15c) Desempate por id quando vigência igual (id maior = mais novo)
{
  const linhas = [linha({ id: 10, valor: 80 }), linha({ id: 20, valor: 95 })]
  const r = resolverPrecoCore(linhas, ctx())
  ok(r.ok && r.tabelaValorId === 20, '15c) desempate por id desc quando vigência igual')
}

// 16) Guarda de valor não-finito: NaN/Infinity nunca vira preço
{
  const rNaN = resolverPrecoCore([linha({ id: 1, valor: Number.NaN })], ctx())
  ok(!rNaN.ok && rNaN.motivo === 'SEM_PRECO_VALIDO', '16) NaN não é preço válido')
  const rInf = resolverPrecoCore([linha({ id: 1, valor: Number.POSITIVE_INFINITY })], ctx())
  ok(!rInf.ok, '16b) Infinity não é preço válido')
}

// 17) Adaptador de compatibilidade (drop-in legado)
{
  const okRes = resolverPrecoCore([linha({ id: 7, valor: 90 })], ctx())
  const c = paraCompat(okRes)
  ok(c != null && c.valor === 90 && c.nivel === 'global' && c.tabelaValorId === 7, '17) paraCompat devolve shape legado')
  ok(paraCompat(resolverPrecoCore([], ctx())) === null, '17b) paraCompat null quando não resolve')
  ok(paraCompat(resolverPrecoCore([], ctx({ fallbackValorPadrao: 120 }))) === null, '17c) paraCompat null no fallback (caller legado trata valorPadrao)')
}

// 18) Sem dataEvento no core → vigência NÃO é filtrada (data futura ainda elegível)
{
  const linhas = [linha({ id: 1, valor: 90, vigenciaInicio: '2999-01-01' })]
  const semData: ContextoPrecoFinanceiro = { itemCatalogoId: ITEM, natureza: NaturezaPreco.RECEITA }
  const r = resolverPrecoCore(linhas, semData)
  ok(r.ok && r.valor === 90, '18) core sem dataEvento não aplica vigência')
}

// 19) Conflito: dois preços válidos no MESMO nível com valores diferentes
{
  const linhas = [linha({ id: 1, valor: 90 }), linha({ id: 2, valor: 110 })]
  const r = resolverPrecoCore(linhas, ctx())
  ok(r.ok && r.conflito != null && r.conflito.competidores.length === 1, '19) conflito sinalizado no mesmo nível')
  ok(r.ok && r.tabelaValorId === 2, '19b) escolha determinística mantida (id maior)')
  ok(r.ok && r.conflito?.nivel === 'global', '19c) conflito aponta o nível')
}

// 20) Sem conflito quando os concorrentes são idênticos (valor+moeda)
{
  const linhas = [linha({ id: 1, valor: 90 }), linha({ id: 2, valor: 90 })]
  const r = resolverPrecoCore(linhas, ctx())
  ok(r.ok && r.conflito == null, '20) preços idênticos não geram conflito')
}

// 21) Conflito é POR NÍVEL: vencedor de nível superior não conflita com global
{
  const linhas = [linha({ id: 1, valor: 90 }), linha({ id: 2, valor: 200, processoId: 7 })]
  const r = resolverPrecoCore(linhas, ctx({ processoId: 7 }))
  ok(r.ok && r.nivel === 'processo' && r.conflito == null, '21) níveis diferentes não são conflito (é precedência)')
}

async function main() {
  // 13) Wrapper async valida itemCatalogoId
  {
    const loader = async () => [linha({ id: 1, valor: 90 })]
    const bad = await resolverPrecoFinanceiro(ctx({ itemCatalogoId: 0 }), loader)
    ok(!bad.ok && bad.motivo === 'ITEM_INVALIDO', '13) wrapper rejeita itemCatalogoId inválido')
    const good = await resolverPrecoFinanceiro(ctx(), loader)
    ok(good.ok && good.valor === 90, '13b) wrapper resolve via loader injetado')
  }

  // 14) custo e receita independentes
  {
    const linhas = [
      linha({ id: 1, valor: 150, natureza: NaturezaPreco.CUSTO, moeda: Moeda.BRL }),
      linha({ id: 2, valor: 90, natureza: NaturezaPreco.RECEITA, moeda: Moeda.EUR }),
    ]
    const loader = async (_item: number, nat: NaturezaPreco | null | undefined) => linhas.filter((l) => l.natureza === nat)
    const r = await resolverCustoEReceitaFinanceiro({ itemCatalogoId: ITEM, dataEvento: DATA }, loader)
    ok(r.custo.ok && r.custo.valor === 150 && r.custo.moeda === Moeda.BRL, '14) custo resolvido independente')
    ok(r.receita.ok && r.receita.valor === 90 && r.receita.moeda === Moeda.EUR, '14b) receita resolvida independente')
  }

  console.log(`\n${passed} passaram, ${failed} falharam`)
  if (failed > 0) {
    console.log('FALHAS: ' + falhas.join('; '))
    process.exit(1)
  }
  console.log('resolverPrecoFinanceiro: núcleo validado ✅')
}

void main()
