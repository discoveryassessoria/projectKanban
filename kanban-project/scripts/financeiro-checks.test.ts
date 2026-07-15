/**
 * _financeiro-checks — testes com FIXTURES (sem banco).
 * Rodar: npx tsx scripts/financeiro-checks.test.ts
 *
 * Valida a lógica de saneamento (usada por inventário e pelo gate de validação)
 * de forma pura, sem tocar o banco.
 */
import { analisarFinanceiro, violacoesDeGate, type DadosFinanceiros, type Achado } from '../prisma/_financeiro-checks'

let passed = 0
let failed = 0
const falhas: string[] = []
function ok(cond: boolean, nome: string) {
  if (cond) { passed++; console.log(`  ✅ ${nome}`) }
  else { failed++; falhas.push(nome); console.log(`  ❌ ${nome}`) }
}
const total = (a: Achado[], chave: string) => a.find((x) => x.chave === chave)?.total ?? -1
const gate = (a: Achado[], chave: string) => a.find((x) => x.chave === chave)?.gate ?? false

function vazio(): DadosFinanceiros {
  return { produtos: [], itens: [], precos: [], honorarios: [], econRules: [], triggerRules: [], tiposDoc: [], servicos: [], tiposServico: [] }
}

console.log('_financeiro-checks — fixtures\n')

// ── Fixture com violações conhecidas ────────────────────────────────────────
const d: DadosFinanceiros = {
  produtos: [
    { id: 1, codigo: 'CIT_CUSTO', nome: 'Certidão — Custo', naturezaFinanceira: 'cost', itemCatalogoId: 1, valorPadrao: 150, ativo: true },
    { id: 2, codigo: 'CIT_RECEITA', nome: 'Certidão — Receita', naturezaFinanceira: 'revenue', itemCatalogoId: 1, valorPadrao: 90, ativo: true },
    { id: 3, codigo: 'DUP', nome: 'x', naturezaFinanceira: 'revenue', itemCatalogoId: 2, valorPadrao: 10, ativo: true },
    { id: 4, codigo: 'DUP', nome: 'y', naturezaFinanceira: 'revenue', itemCatalogoId: 3, valorPadrao: 10, ativo: true },
    { id: 5, codigo: 'ORF', nome: 'orfao', naturezaFinanceira: 'cost', itemCatalogoId: null, valorPadrao: 5, ativo: true },
  ],
  itens: [
    { id: 1, code: 'CERT_NASC_IT', name: 'Certidão de Nascimento', natureza: 'DOCUMENTO', ativo: true, _count: { tiposDocumento: 1, produtos: 2, servicos: 0, precos: 1, tiposServico: 0, necessidades: 0 } },
    { id: 9, code: 'DOC_CERTIDAO_NASCIMENTO', name: 'Certidão de Nascimento', natureza: 'DOCUMENTO', ativo: true, _count: { tiposDocumento: 0, produtos: 0, servicos: 0, precos: 0, tiposServico: 0, necessidades: 0 } },
  ],
  precos: [
    { id: 1, name: '[AJUSTAR] global', valor: 0, moeda: 'BRL', natureza: 'CUSTO', itemCatalogoId: 1, arquivado: false },
    { id: 2, name: 'sem chave', valor: 50, moeda: 'EUR', natureza: null, itemCatalogoId: null, arquivado: false },
  ],
  honorarios: [{ id: 1, code: 'HON1', name: 'Honorário base', servico: 'Tradução', valorPadrao: 500, momentoCobranca: 'contract_signed', ativo: true }],
  econRules: [{ id: 1, documentTypeCode: 'INEXISTE', custoProdutoCode: 'CIT_CUSTO', receitaProdutoCode: 'NOPE', componentName: 'Certidão IT', componentKey: 'CIT' }],
  triggerRules: [
    { id: 1, itemCode: 'GHOST', financialItemId: null, name: 'g', active: true },
    { id: 2, itemCode: 'CIT_CUSTO', financialItemId: 1, name: 'ok', active: true },
  ],
  tiposDoc: [{ id: 1, code: 'IT-NAS', name: 'Nascimento', legacyEnumKey: 'CERTIDAO_NASCIMENTO', itemCatalogoId: 1 }],
  servicos: [{ id: 1, code: 'SRV', name: 'Serviço', itemCatalogoId: null }],
  tiposServico: [{ id: 1, nome: 'Trad', itemCatalogoId: null }],
}

const a = analisarFinanceiro(d)

ok(total(a, 'espelho_custo_receita_por_item') === 1, 'espelho custo+receita no item 1')
ok(total(a, 'pares_sufixo_custo_receita') === 1, 'par _CUSTO/_RECEITA (base CIT)')
ok(total(a, 'codigo_produto_duplicado') === 1 && gate(a, 'codigo_produto_duplicado'), 'codigo DUP duplicado (GATE)')
ok(total(a, 'documento_catalogo_sobreposto') === 1, 'documento sobreposto por nome (DOC_ vs CERT_)')
ok(total(a, 'marcadores_teste') === 1, 'marcador [AJUSTAR] detectado')
ok(total(a, 'preco_zero') === 1 && gate(a, 'preco_zero'), 'preço 0 detectado (GATE)')
ok(total(a, 'preco_invisivel_resolver') === 1 && gate(a, 'preco_invisivel_resolver'), 'preço invisível ao resolver (GATE)')
ok(total(a, 'produto_sem_item_mestre') === 1 && gate(a, 'produto_sem_item_mestre'), 'produto órfão (GATE)')
ok(total(a, 'item_sem_consumidor') === 1, 'item 9 sem consumidor')
ok(total(a, 'honorario_orfao_catalogo') === 1 && !gate(a, 'honorario_orfao_catalogo'), 'honorário órfão (não-gate)')
ok(total(a, 'servico_sem_item') === 1, 'serviço sem item')
ok(total(a, 'tiposervico_sem_item') === 1, 'tipoServico sem item')
ok(total(a, 'econ_documentTypeCode_quebrado') === 1 && gate(a, 'econ_documentTypeCode_quebrado'), 'documentTypeCode quebrado (GATE)')
ok(total(a, 'econ_produtoCode_quebrado') === 1 && gate(a, 'econ_produtoCode_quebrado'), 'produtoCode quebrado NOPE (GATE)')
ok(total(a, 'trigger_itemCode_quebrado') === 1 && gate(a, 'trigger_itemCode_quebrado'), 'trigger itemCode GHOST quebrado (GATE)')
ok(total(a, 'trigger_sem_financialItemId') === 1, 'trigger sem financialItemId')

ok(violacoesDeGate(a).length >= 6, 'violacoesDeGate agrega os gates > 0')

// ── Fixture limpa → nenhum gate, quase tudo zero ────────────────────────────
const limpo = vazio()
limpo.produtos = [{ id: 1, codigo: 'A', nome: 'A', naturezaFinanceira: 'revenue', itemCatalogoId: 1, valorPadrao: 10, ativo: true }]
limpo.itens = [{ id: 1, code: 'X', name: 'X', natureza: 'PRODUTO', ativo: true, _count: { tiposDocumento: 0, produtos: 1, servicos: 0, precos: 1, tiposServico: 0, necessidades: 0 } }]
limpo.precos = [{ id: 1, name: 'p', valor: 90, moeda: 'EUR', natureza: 'RECEITA', itemCatalogoId: 1, arquivado: false }]
const la = analisarFinanceiro(limpo)
ok(violacoesDeGate(la).length === 0, 'fixture limpa: nenhuma violação de gate')
ok(total(la, 'preco_zero') === 0 && total(la, 'produto_sem_item_mestre') === 0, 'fixture limpa: sem zero, sem órfão')

console.log(`\n${passed} passaram, ${failed} falharam`)
if (failed > 0) { console.log('FALHAS: ' + falhas.join('; ')); process.exit(1) }
console.log('_financeiro-checks: validado ✅')
