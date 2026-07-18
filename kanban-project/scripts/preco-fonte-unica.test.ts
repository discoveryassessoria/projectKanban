/**
 * TESTES — PREÇO-FONTE-ÚNICA (§14). Puros, sem banco.
 * Rodar: tsx scripts/preco-fonte-unica.test.ts  (ou npm run test:preco-fonte-unica)
 *
 * Cobre: compatibilidade de natureza (§2/§4), derivação de naturezaFin (§10),
 * VENDA≡RECEITA (§2), resolução sem zero silencioso e com pendência (§5),
 * conflito de mesma precedência bloqueia (§5), congelamento de unitário/qtd (§6),
 * detecção de duplicidade de preços (§3), custo e venda como movimentos distintos (§4).
 */
import {
  deriveNaturezaFinanceira, validarNaturezaPreco, validarNaturezaRegra,
  canonicalNaturezaPreco, admiteCusto, admiteVenda,
  precoNaturezaDeEnum, mapPrecoParaLancamento, lancamentoDeEnumPreco,
} from '../lib/financeiro/natureza-financeira'
import { detectarConflitoPreco, conflitam, type PrecoRegistro } from '../lib/financeiro/conflito-preco'
import { resolverPrecoCore, type LinhaPreco, type ContextoPrecoFinanceiro } from '../src/lib/motor/resolver-preco-financeiro'

let passed = 0, failed = 0
const falhas: string[] = []
function ok(cond: boolean, nome: string) { if (cond) { passed++; console.log(`  ✅ ${nome}`) } else { failed++; falhas.push(nome); console.log(`  ❌ ${nome}`) } }

// Fábricas
const linha = (o: Partial<LinhaPreco> & { id: number; valor: number }): LinhaPreco =>
  ({ moeda: 'BRL' as any, natureza: null, ...o })
const ctx = (o: Partial<ContextoPrecoFinanceiro> = {}): ContextoPrecoFinanceiro =>
  ({ itemCatalogoId: 1, ...o })
const preco = (o: Partial<PrecoRegistro> & { id: number }): PrecoRegistro =>
  ({ configuracaoFinanceiraItemId: 10, natureza: 'CUSTO', prioridade: 0, arquivado: false, legadoPendente: false, ...o })

console.log('\n§1/§10 — derivação de NaturezaFinanceira')
ok(deriveNaturezaFinanceira({ possuiCusto: true }) === 'SOMENTE_CUSTO', 'só custo → SOMENTE_CUSTO')
ok(deriveNaturezaFinanceira({ possuiReceita: true }) === 'SOMENTE_RECEITA', 'só receita → SOMENTE_RECEITA')
ok(deriveNaturezaFinanceira({ possuiCusto: true, possuiReceita: true }) === 'CUSTO_E_RECEITA', 'ambos → CUSTO_E_RECEITA')
ok(deriveNaturezaFinanceira({ valorCustoPadrao: 50 }) === 'SOMENTE_CUSTO', 'valorCustoPadrao>0 deriva custo')
ok(deriveNaturezaFinanceira({}) === null, 'sem sinal → null')
ok(deriveNaturezaFinanceira({ naturezaFin: 'CUSTO_E_RECEITA', possuiCusto: false }) === 'CUSTO_E_RECEITA', 'campo explícito tem prioridade')

console.log('\n§2 — canônico de PREÇO (RECEITA legado ≡ VENDA no lado do PREÇO)')
ok(canonicalNaturezaPreco('RECEITA') === 'VENDA', 'RECEITA → VENDA (preço)')
ok(canonicalNaturezaPreco('VENDA') === 'VENDA', 'VENDA → VENDA (preço)')
ok(canonicalNaturezaPreco('CUSTO') === 'CUSTO', 'CUSTO → CUSTO (preço)')

console.log('\n§1 — mapeamento explícito PREÇO → LANÇAMENTO (serviço único)')
ok(precoNaturezaDeEnum('VENDA') === 'PRECO_VENDA' && precoNaturezaDeEnum('RECEITA') === 'PRECO_VENDA', 'enum VENDA/RECEITA → PRECO_VENDA (natureza de PREÇO)')
ok(precoNaturezaDeEnum('CUSTO') === 'PRECO_CUSTO', 'enum CUSTO → PRECO_CUSTO')
ok(mapPrecoParaLancamento('PRECO_VENDA') === 'RECEITA', 'PRECO_VENDA gera lançamento de RECEITA')
ok(mapPrecoParaLancamento('PRECO_CUSTO') === 'CUSTO', 'PRECO_CUSTO gera lançamento de CUSTO')
ok(lancamentoDeEnumPreco('VENDA') === 'RECEITA' && lancamentoDeEnumPreco('CUSTO') === 'CUSTO', 'atalho enum-preço → natureza de LANÇAMENTO')
// VENDA é natureza de PREÇO, NÃO de lançamento: só vira RECEITA ao mapear (na geração).
ok(String(precoNaturezaDeEnum('VENDA')) === 'PRECO_VENDA', 'VENDA (preço) é PRECO_VENDA, não o lançamento RECEITA antes de mapear')

console.log('\n§2/§4 — compatibilidade de natureza contra a Config')
ok(validarNaturezaPreco('SOMENTE_CUSTO', 'CUSTO').ok, 'SOMENTE_CUSTO aceita Preço de Custo')
ok(!validarNaturezaPreco('SOMENTE_CUSTO', 'VENDA').ok, 'SOMENTE_CUSTO REJEITA Preço de Venda')
ok(validarNaturezaPreco('SOMENTE_RECEITA', 'VENDA').ok, 'SOMENTE_RECEITA aceita Preço de Venda')
ok(validarNaturezaPreco('SOMENTE_RECEITA', 'RECEITA').ok, 'SOMENTE_RECEITA aceita RECEITA (legado=VENDA)')
ok(!validarNaturezaPreco('SOMENTE_RECEITA', 'CUSTO').ok, 'SOMENTE_RECEITA REJEITA Preço de Custo')
ok(validarNaturezaPreco('CUSTO_E_RECEITA', 'CUSTO').ok && validarNaturezaPreco('CUSTO_E_RECEITA', 'VENDA').ok, 'CUSTO_E_RECEITA aceita as duas')
ok(admiteCusto('CUSTO_E_RECEITA') && admiteVenda('CUSTO_E_RECEITA'), 'CUSTO_E_RECEITA admite ambos')

console.log('\n§4 — Regra Financeira: natureza compatível')
ok(!validarNaturezaRegra('SOMENTE_CUSTO', false, true).ok, 'regra não gera VENDA em SOMENTE_CUSTO')
ok(!validarNaturezaRegra('SOMENTE_RECEITA', true, false).ok, 'regra não gera CUSTO em SOMENTE_RECEITA')
ok(validarNaturezaRegra('CUSTO_E_RECEITA', true, true).ok, 'CUSTO_E_RECEITA pode gerar ambos (2 movimentos)')

console.log('\n§5 — resolução: nunca zero silencioso; pendência')
const semLinha = resolverPrecoCore([], ctx({ natureza: 'CUSTO' as any }))
ok(!semLinha.ok && semLinha.motivo === 'NENHUMA_LINHA', 'sem preço → ok:false (não cria zero)')
const soZero = resolverPrecoCore([linha({ id: 1, valor: 0, natureza: 'CUSTO' as any })], ctx({ natureza: 'CUSTO' as any }))
ok(!soZero.ok && soZero.motivo === 'SEM_PRECO_VALIDO', 'preço zero → ok:false (SEM_PRECO_VALIDO)')

console.log('\n§2 — resolver casa VENDA pedida contra linha RECEITA (legado)')
const vendaLegado = resolverPrecoCore([linha({ id: 1, valor: 200, natureza: 'RECEITA' as any })], ctx({ natureza: 'VENDA' as any }))
ok(vendaLegado.ok && vendaLegado.valor === 200, 'pedir VENDA resolve linha RECEITA')

console.log('\n§5 — conflito de mesma precedência é reportado (motor bloqueia)')
const doisGlobais = resolverPrecoCore([
  linha({ id: 1, valor: 100, natureza: 'CUSTO' as any }),
  linha({ id: 2, valor: 150, natureza: 'CUSTO' as any }),
], ctx({ natureza: 'CUSTO' as any }))
ok(doisGlobais.ok && !!doisGlobais.conflito, 'dois preços válidos no mesmo nível → conflito presente')

console.log('\n§5 — precedência escolhe o mais específico (sem ambiguidade)')
const especifico = resolverPrecoCore([
  linha({ id: 1, valor: 100, natureza: 'CUSTO' as any }),
  linha({ id: 2, valor: 150, natureza: 'CUSTO' as any, processoTipoId: '7' }),
], ctx({ natureza: 'CUSTO' as any, tipoProcessoId: 7 }))
ok(especifico.ok && especifico.valor === 150 && especifico.especificidade === 1 && !especifico.conflito, 'tipoProcesso (espec 1) vence global (espec 0), sem conflito')

console.log('\n§6 — congelamento: unitário × quantidade (per_unit)')
const perUnit = resolverPrecoCore([linha({ id: 1, valor: 30, natureza: 'CUSTO' as any, modoCalculo: 'per_unit' })], ctx({ natureza: 'CUSTO' as any, quantidade: 3 }))
ok(perUnit.ok && perUnit.valorUnitario === 30 && perUnit.quantidade === 3 && perUnit.valor === 90 && perUnit.modoCalculo === 'per_unit', 'per_unit congela unitário=30, qtd=3, total=90')

console.log('\n§3 — detecção de duplicidade/conflito de preço')
const base = preco({ id: 1 })
ok(conflitam(base, preco({ id: 2 })), 'mesmo contexto+prioridade+vigência aberta → conflita')
ok(!conflitam(base, preco({ id: 2, prioridade: 1 })), 'prioridade distinta → NÃO conflita')
ok(!conflitam(base, preco({ id: 2, fornecedorId: 9 })), 'fornecedor distinto → NÃO conflita')
ok(!conflitam(base, preco({ id: 2, natureza: 'VENDA' })), 'natureza distinta → NÃO conflita')
ok(conflitam(base, preco({ id: 2, quantidadeMinima: 10, quantidadeMaxima: 20 })), 'faixa aberta sobrepõe faixa 10-20 → conflita')
ok(conflitam(preco({ id: 1, quantidadeMinima: 1, quantidadeMaxima: 5 }), preco({ id: 2, quantidadeMinima: 4, quantidadeMaxima: 9 })), 'faixas 1-5 e 4-9 sobrepõem → conflita')
ok(!conflitam(preco({ id: 1, quantidadeMinima: 1, quantidadeMaxima: 5 }), preco({ id: 2, quantidadeMinima: 6, quantidadeMaxima: 9 })), 'faixas 1-5 e 6-9 disjuntas → NÃO conflita')
ok(!conflitam(preco({ id: 1, vigenciaInicio: '2024-01-01', vigenciaFim: '2025-12-31' }), preco({ id: 2, vigenciaInicio: '2030-01-01', vigenciaFim: '2031-12-31' })), 'vigências disjuntas → NÃO conflita')
ok(conflitam(preco({ id: 1, vigenciaInicio: '2024-01-01', vigenciaFim: '2026-12-31' }), preco({ id: 2, vigenciaInicio: '2026-01-01', vigenciaFim: '2027-12-31' })), 'vigências sobrepostas → conflita')
const conf = detectarConflitoPreco(preco({ id: undefined as any }), [base])
ok(!conf.ok && conf.conflitantes.includes(1), 'detectarConflitoPreco aponta a regra conflitante')
ok(detectarConflitoPreco(preco({ id: 1 }), [base]).ok, 'edição da própria linha não conflita consigo mesma')

console.log('\n§4 — custo e venda: movimentos DISTINTOS (chaves distintas)')
ok(canonicalNaturezaPreco('CUSTO') !== canonicalNaturezaPreco('VENDA'), 'CUSTO e VENDA são naturezas distintas (2 lançamentos legítimos)')

console.log(`\n=== ${passed} passaram, ${failed} falharam ===`)
if (failed) { console.log('FALHAS:', falhas.join('; ')); process.exit(1) }
