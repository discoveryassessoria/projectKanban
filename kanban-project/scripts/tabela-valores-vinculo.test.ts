/**
 * GUARDA — Tabela de Preços: o vínculo do item tem UMA fonte da verdade.
 * Rodar: npm run test:tabela-valores-vinculo
 *
 * O defeito que este teste trava: o modal "Novo valor" mantinha DOIS campos para
 * o mesmo fato — `itemCatalogoId` (o que era gravado e enviado) e
 * `configuracaoFinanceiraItemId` (o que a tela consultava para decidir se havia
 * item selecionado). Como a Configuração Financeira é NULA enquanto o item nunca
 * foi precificado — em produção, todo Documento Mestre —, o item aparecia
 * escolhido e o formulário continuava achando que nada fora selecionado:
 * naturezas desabilitadas, cadastro impossível.
 *
 * O COMPORTAMENTO está provado em testes/tabela-valores-vinculo-item.test.tsx
 * (render real). Aqui ficam os contratos estruturais: campo único na tela e
 * validação por ID no backend.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..')
const src = (p: string) => readFileSync(join(RAIZ, p), 'utf8')

let passou = 0, falhou = 0
const falhas: string[] = []
const ok = (n: string, c: boolean) => { if (c) { passou++; console.log(`  ✅ ${n}`) } else { falhou++; falhas.push(n); console.log(`  ❌ ${n}`) } }
const secao = (t: string) => console.log(`\n${t}`)

console.log('Tabela de Preços — vínculo do item por ID, fonte única\n')

const tela = src('src/components/gerenciamentoComponents/TabelaValoresTab.tsx')
const api = src('src/app/api/gerenciamento/tabela-valores/route.ts')
const apiId = src('src/app/api/gerenciamento/tabela-valores/[id]/route.ts')
const comportamento = src('testes/tabela-valores-vinculo-item.test.tsx')

secao('1) UM campo canônico no formulário — sem estado duplicado')
{
  ok('o formulário declara itemCatalogoId', /itemCatalogoId: '',/.test(tela))
  ok('não existe mais configuracaoFinanceiraItemId no estado do formulário', !/configuracaoFinanceiraItemId: '',/.test(tela))
  ok('a tela não grava configuracaoFinanceiraItemId em nenhum setForm', !/configuracaoFinanceiraItemId:\s*(c\?|String|Number)/.test(tela))
  ok('o item selecionado é resolvido pelo MESMO id que o form grava', tela.includes('configs.find((c) => String(c.itemCatalogoId) === form.itemCatalogoId)'))
  ok('a resolução por id da config (nula em item novo) não existe mais', !tela.includes('String(c.id) === form.configuracaoFinanceiraItemId'))
}

secao('2) Seletor: value, onChange e rótulo apontam para o mesmo ID')
{
  ok('o value do seletor é o id canônico', tela.includes('value={form.itemCatalogoId}'))
  ok('a opção carrega o id do item', tela.includes('value={c.itemCatalogoId}'))
  ok('há um único ponto de gravação da seleção', tela.includes('function selecionarItem(id: string)') && tela.includes('onChange={(e) => selecionarItem(e.target.value)}'))
  ok('o rótulo é derivado do item do ID', tela.includes('const rotuloItemVinculado'))
  ok('a tela confirma o vínculo ao operador', tela.includes('Item vinculado:'))
  ok('selecionar limpa o erro de validação', /function selecionarItem[\s\S]{0,700}setErroModal\(null\)/.test(tela))
}

secao('3) Naturezas dependem do ITEM, não da existência de config')
{
  ok('habilitação usa o item vinculado', tela.includes('const itemVinculado = !!form.itemCatalogoId'))
  ok('o que o item admite vem do próprio item', tela.includes('itemSelecionado?.possuiCusto') && tela.includes('itemSelecionado?.possuiReceita'))
  ok('checkbox de custo não depende mais da config existente', !/disabled=\{!cfgSelecionada/.test(tela))
  ok('trocar o tipo derruba item e naturezas', tela.includes('...SEM_ITEM, categoria: e.target.value'))
  ok('sair do item derruba as naturezas', /if \(!c\) \{ setForm\(\(f\) => \(\{ \.\.\.f, \.\.\.SEM_ITEM \}\)\)/.test(tela))
}

secao('4) Payload: ID, nunca texto')
{
  ok('envia o id canônico', tela.includes('itemCatalogoId: Number(form.itemCatalogoId)'))
  ok('envia o tipo apenas para validação', tela.includes('itemTipo: form.categoria'))
  ok('não envia a config (resolvida no backend)', !/configuracaoFinanceiraItemId: Number\(form\./.test(tela))
  ok('nenhum nome/código do item é enviado como vínculo', !/itemNome|itemCodigo|itemLabel/.test(tela))
}

secao('5) Backend valida por ID e recusa incompatibilidade')
{
  ok('item é buscado por ID (findUnique)', api.includes('prisma.itemCatalogo.findUnique'))
  ok('item inexistente é erro de domínio', api.includes('Item do catálogo inexistente'))
  ok('item inativo é recusado', api.includes('Item inativo não pode receber preço'))
  ok('tipo × item incompatível é recusado', api.includes('Item incompatível com o tipo selecionado'))
  ok('a guarda de tipo roda no caminho do item', /if \(itemTipo && String\(item\.natureza\) !== itemTipo\)/.test(api))
  ok('a guarda de tipo também cobre o caminho da config', /cfg\.itemCatalogo && String\(cfg\.itemCatalogo\.natureza\) !== itemTipo/.test(api))
  ok('nenhuma resolução por nome/substring', !/findFirst\([^)]*name:\s*\{\s*contains/.test(api))
  ok('sem fallback silencioso: sem item resolvido, recusa', api.includes("return NextResponse.json({ error: 'Selecione o item.' }, { status: 400 })"))
  ok('trocar o item de um preço existente é recusado', apiId.includes('Não é permitido trocar o item de um preço existente'))
}

secao('6) O comportamento está provado por render, não só por leitura')
{
  ok('existe teste de componente do vínculo', comportamento.includes("screen.getByLabelText('Item')"))
  ok('prova o caso do item SEM Configuração Financeira', comportamento.includes('id: null, possuiCusto: true'))
  ok('prova que o submit leva o ID', comportamento.includes('expect(corpo.itemCatalogoId).toBe(DOC.itemCatalogoId)'))
  ok('prova custo e venda juntos', comportamento.includes('expect(corpo.precoVenda).toBe(true)'))
}

console.log(`\n${'='.repeat(60)}`)
console.log(`Vínculo do item: ${passou} passaram, ${falhou} falharam`)
if (falhou > 0) { console.log('\nFalhas:'); for (const f of falhas) console.log(`  · ${f}`); process.exit(1) }
console.log('Vínculo do item por ID validado ✅')
