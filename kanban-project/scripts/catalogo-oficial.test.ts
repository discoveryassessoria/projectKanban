/**
 * TESTES — CADASTRO MESTRE OFICIAL (elegibilidade a lançamento). Puros, sem banco.
 * Rodar: tsx scripts/catalogo-oficial.test.ts  (ou npm run test:catalogo-oficial)
 *
 * Cobre os casos exigidos: item legado, item sem Configuração Financeira, item
 * somente receita, item somente custo, item elegível para ambos — mais vigência
 * de preço, item/config inativos e a GUARDA arquitetural (nenhuma tela ou rota
 * volta a expor cadastro eliminado).
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  NATUREZAS_ITEM_ELIMINADAS, NATUREZAS_ITEM_OFICIAIS,
  naturezaItemEliminada, naturezaItemOficial,
  precoVigente, exigePrecoVigente, elegibilidadeParaLancamento, hojeISO,
  type ItemMestreLike, type ConfigFinanceiraLike, type PrecoLike,
} from '../lib/financeiro/catalogo-oficial'

let passed = 0, failed = 0
const falhas: string[] = []
function ok(cond: boolean, nome: string) { if (cond) { passed++; console.log(`  ✅ ${nome}`) } else { failed++; falhas.push(nome); console.log(`  ❌ ${nome}`) } }

const HOJE = '2026-07-29'
const raiz = join(__dirname, '..')
const ler = (p: string) => readFileSync(join(raiz, p), 'utf8')

// Fábricas
const item = (o: Partial<ItemMestreLike> = {}): ItemMestreLike => ({ ativo: true, natureza: 'SERVICO', ...o })
const cfg = (o: Partial<ConfigFinanceiraLike> = {}): ConfigFinanceiraLike => ({ ativo: true, naturezaFin: 'CUSTO_E_RECEITA', ...o })
const precoVenda = (o: Partial<PrecoLike> = {}): PrecoLike => ({ natureza: 'VENDA', arquivado: false, legadoPendente: false, ...o })
const precoCusto = (o: Partial<PrecoLike> = {}): PrecoLike => ({ natureza: 'CUSTO', arquivado: false, legadoPendente: false, ...o })

const custo = (i: ItemMestreLike | null, c: ConfigFinanceiraLike | null, precos: PrecoLike[] = []) =>
  elegibilidadeParaLancamento({ item: i, config: c, precos, natureza: 'CUSTO', hoje: HOJE })
const receita = (i: ItemMestreLike | null, c: ConfigFinanceiraLike | null, precos: PrecoLike[] = []) =>
  elegibilidadeParaLancamento({ item: i, config: c, precos, natureza: 'RECEITA', hoje: HOJE })

console.log('\n1) Classificação: oficial × eliminada')
ok(naturezaItemEliminada('HONORARIO'), 'HONORARIO é estrutura eliminada')
ok(naturezaItemEliminada('PRODUTO'), 'PRODUTO é estrutura eliminada')
ok(!naturezaItemEliminada('SERVICO'), 'SERVICO não é eliminada')
ok(naturezaItemOficial('DOCUMENTO') && naturezaItemOficial('SERVICO'), 'Documento e Serviço são oficiais')
ok(NATUREZAS_ITEM_ELIMINADAS.every((n) => !NATUREZAS_ITEM_OFICIAIS.includes(n)), 'nenhuma eliminada aparece na lista oficial')
ok(!naturezaItemOficial(null) && !naturezaItemOficial('QUALQUER_COISA'), 'classificação desconhecida não é oficial')

console.log('\n2) Item LEGADO nunca origina lançamento novo')
const legadoHon = item({ natureza: 'HONORARIO' })
ok(custo(legadoHon, cfg()).motivo === 'NATUREZA_ELIMINADA', 'Honorário não é elegível a CUSTO (mesmo com config válida)')
ok(receita(legadoHon, cfg(), [precoVenda()]).motivo === 'NATUREZA_ELIMINADA', 'Honorário não é elegível a RECEITA (mesmo com preço)')
ok(custo(item({ natureza: 'PRODUTO' }), cfg()).motivo === 'NATUREZA_ELIMINADA', 'Produto não é elegível a CUSTO')

console.log('\n3) Item SEM Configuração Financeira')
ok(custo(item(), null).motivo === 'SEM_CONFIGURACAO_FINANCEIRA', 'sem config não gera custo')
ok(receita(item(), null, [precoVenda()]).motivo === 'SEM_CONFIGURACAO_FINANCEIRA', 'sem config não gera receita')
ok(custo(item(), cfg({ ativo: false })).motivo === 'CONFIGURACAO_INATIVA', 'config inativa não gera lançamento')
ok(custo(item(), cfg({ naturezaFin: null, possuiCusto: false, possuiReceita: false })).motivo === 'NATUREZA_FINANCEIRA_INDEFINIDA', 'config sem natureza financeira não gera lançamento')

console.log('\n4) Item SOMENTE RECEITA')
const soReceita = cfg({ naturezaFin: 'SOMENTE_RECEITA' })
ok(receita(item(), soReceita, [precoVenda()]).ok, 'somente-receita é elegível a RECEITA (com preço vigente)')
ok(custo(item(), soReceita).motivo === 'NAO_ELEGIVEL_A_NATUREZA', 'somente-receita NÃO é elegível a CUSTO')

console.log('\n5) Item SOMENTE CUSTO')
const soCusto = cfg({ naturezaFin: 'SOMENTE_CUSTO' })
ok(custo(item(), soCusto).ok, 'somente-custo é elegível a CUSTO')
ok(receita(item(), soCusto, [precoVenda()]).motivo === 'NAO_ELEGIVEL_A_NATUREZA', 'somente-custo NÃO é elegível a RECEITA')

console.log('\n6) Item elegível para AMBOS')
const ambos = cfg({ naturezaFin: 'CUSTO_E_RECEITA' })
ok(custo(item(), ambos).ok, 'custo-e-receita é elegível a CUSTO')
ok(receita(item(), ambos, [precoVenda()]).ok, 'custo-e-receita é elegível a RECEITA')
ok(custo(item({ natureza: 'DOCUMENTO' }), ambos).ok, 'Documento cobrado do cliente é item oficial (elegibilidade vem da config, não do rótulo)')

console.log('\n7) Derivação por flags legadas (config em transição)')
ok(custo(item(), cfg({ naturezaFin: null, possuiCusto: true, possuiReceita: false })).ok, 'possuiCusto deriva SOMENTE_CUSTO')
ok(receita(item(), cfg({ naturezaFin: null, possuiCusto: false, possuiReceita: true }), [precoVenda()]).ok, 'possuiReceita deriva SOMENTE_RECEITA')

console.log('\n8) Vigência do preço na Tabela de Valores')
ok(exigePrecoVigente('RECEITA') && !exigePrecoVigente('CUSTO'), 'preço vigente é exigido na RECEITA, não no CUSTO')
ok(receita(item(), ambos, []).motivo === 'SEM_PRECO_VIGENTE', 'receita sem preço cadastrado é recusada')
ok(receita(item(), ambos, [precoVenda({ arquivado: true })]).motivo === 'SEM_PRECO_VIGENTE', 'preço arquivado não vale')
ok(receita(item(), ambos, [precoVenda({ legadoPendente: true })]).motivo === 'SEM_PRECO_VIGENTE', 'preço legadoPendente não vale')
ok(receita(item(), ambos, [precoVenda({ natureza: null })]).motivo === 'SEM_PRECO_VIGENTE', 'preço de natureza ambígua (null) não vale')
ok(receita(item(), ambos, [precoCusto()]).motivo === 'SEM_PRECO_VIGENTE', 'preço de CUSTO não habilita RECEITA')
ok(receita(item(), ambos, [precoVenda({ vigenciaInicio: '2026-08-01' })]).motivo === 'SEM_PRECO_VIGENTE', 'preço que só começa amanhã não vale hoje')
ok(receita(item(), ambos, [precoVenda({ vigenciaFim: '2026-07-28' })]).motivo === 'SEM_PRECO_VIGENTE', 'preço expirado não vale')
ok(receita(item(), ambos, [precoVenda({ vigenciaInicio: '2026-01-01', vigenciaFim: '2026-12-31' })]).ok, 'preço dentro da vigência vale')
ok(precoVigente(precoVenda({ natureza: 'RECEITA' }), 'RECEITA', HOJE), 'RECEITA é apelido legado de VENDA no lado do preço')
ok(custo(item(), ambos, []).ok, 'custo sem preço cadastrado continua elegível (valor é o praticado pelo fornecedor)')

console.log('\n9) Estado do item')
ok(custo(null, ambos).motivo === 'ITEM_INEXISTENTE', 'item inexistente é recusado')
ok(custo(item({ ativo: false }), ambos).motivo === 'ITEM_INATIVO', 'item inativo é recusado')
ok(hojeISO(new Date('2026-07-29T03:00:00Z')) === '2026-07-29', 'data de referência no formato da Tabela de Valores')

console.log('\n10) GUARDA — a fonte do legado continua fechada')
const rotaItens = ler('src/app/api/financeiro/v3/itens-catalogo/route.ts')
ok(/NATUREZAS_ITEM_OFICIAIS/.test(rotaItens) && /elegibilidadeParaLancamento/.test(rotaItens), 'seletor filtra pela regra oficial no servidor')
ok(/produtos: \{ some: \{ ativo: true \} \}/.test(rotaItens), 'seletor exige Configuração Financeira ativa já na consulta')

const lancManual = ler('lib/financeiro/extras/lancamento-manual.ts')
ok(/elegibilidadeParaLancamento/.test(lancManual), 'criação de custo valida a MESMA regra (POST direto não escapa)')
const receitaManual = ler('lib/financeiro/receitas/criar-receita-manual.ts')
ok(/elegibilidadeParaLancamento/.test(receitaManual), 'criação de receita valida a MESMA regra')
ok(/fallbackValorPadrao: null/.test(receitaManual), 'receita não cai no valor legado da configuração')
ok(/fallbackValorPadrao: null/.test(ler('src/app/api/financeiro/v3/item-config/route.ts')), 'auto-preenchimento não cai no valor legado da configuração')

const sync = ler('src/services/catalogo-sync.ts')
ok(!/NaturezaItem\.PRODUTO/.test(sync), 'espelho de configuração não nasce mais com nomenclatura eliminada')

const produtosRoute = ler('src/app/api/gerenciamento/produtos/route.ts')
ok(!/prisma\.honorario\.find/.test(produtosRoute), 'Configurações Financeiras não consultam mais a tabela legada Honorario')
ok(/Honorário não é mais um cadastro mestre/.test(produtosRoute), 'novo vínculo a Honorário é recusado pelo servidor')
const categoriasRoute = ler('src/app/api/gerenciamento/categorias/route.ts')
ok(!/prisma\.honorario\.find/.test(categoriasRoute), 'Categorias Financeiras não consultam mais a tabela legada Honorario')

const catMestre = ler('src/app/api/gerenciamento/catalogo-mestre/route.ts')
ok(/NATUREZAS_ITEM_OFICIAIS/.test(catMestre) && !/Object\.values\(NaturezaItem\)/.test(catMestre), 'Catálogo Mestre só oferece/aceita naturezas oficiais')

// O formulário legado (LancamentoManualModal) foi ELIMINADO — o fluxo definitivo
// é lancamento/LancamentoFinanceiroModal + SeletorItemCatalogo. A guarda segue o
// fluxo vivo: nenhum rótulo de cadastro eliminado e nenhuma correção cosmética
// no cliente (a coleção que chega do servidor já é a final).
const fluxo = [
  'src/components/financeiro/v3/lancamento/LancamentoFinanceiroModal.tsx',
  'src/components/financeiro/v3/lancamento/SeletorItemCatalogo.tsx',
  'src/components/financeiro/v3/lancamento/campos.tsx',
].map(ler).join('\n')
ok(!/PRODUTO:|HONORARIO:/.test(fluxo), 'o formulário de lançamento não tem rótulo de cadastro eliminado')
ok(!/filter\([^)]*natureza[^)]*(HONORARIO|PRODUTO)/.test(fluxo), 'o frontend não faz correção cosmética da lista')

const itensRoute = ler('src/app/api/financeiro/v3/itens-catalogo/route.ts')
ok(/elegibilidadeParaLancamento/.test(itensRoute) && /NATUREZAS_ITEM_OFICIAIS/.test(itensRoute),
  'o seletor do lançamento aplica a regra oficial no servidor (fonte única)')

console.log(`\n${passed} passaram, ${failed} falharam`)
if (failed) { console.log('Falhas:'); falhas.forEach((f) => console.log(`  - ${f}`)); process.exit(1) }
console.log('Cadastro Mestre oficial: elegibilidade e guarda arquitetural validadas ✅')
