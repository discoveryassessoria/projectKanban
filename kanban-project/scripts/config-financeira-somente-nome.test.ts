/**
 * GUARDA — CONFIGURAÇÕES FINANCEIRAS EXIBE SOMENTE O NOME.
 * Rodar: npm run test:config-somente-nome
 *
 * A REGRA
 * -------
 * Configurações Financeiras é tela de parametrização: identifica o cadastro
 * mestre pelo NOME LEGÍVEL em todos os pontos visuais — listagem, dropdown,
 * valor selecionado, modais de criação/edição/exclusão.
 *
 * Código público (SRV-n) e chave estrutural pertencem ao CADASTRO DE ORIGEM, o
 * Catálogo de Serviços, e continuam visíveis lá.
 *
 * DADO PESQUISÁVEL ≠ DADO EXIBIDO: a busca continua aceitando SRV-n e chave.
 * Estes testes cobrem os dois lados — se a busca por SRV-8 parar de funcionar,
 * "não exibe código" teria sido cumprido do jeito errado.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  nomeExibidoDoMestre, termosBuscaveisDoMestre, combinaComBusca,
  mestreDaConfiguracao, mestreSelecionavel,
} from '../lib/gerenciamento/mestre-financeiro'
import { unificarCatalogo, type ServicoBruto } from '../lib/gerenciamento/catalogo-servicos'

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..')
const src = (p: string) => readFileSync(join(RAIZ, p), 'utf8')

let passou = 0, falhou = 0
const falhas: string[] = []
const ok = (nome: string, cond: boolean, extra = '') => {
  if (cond) { passou++; console.log(`  ✅ ${nome}${extra ? ` — ${extra}` : ''}`) }
  else { falhou++; falhas.push(nome); console.log(`  ❌ ${nome}${extra ? ` — ${extra}` : ''}`) }
}
const secao = (t: string) => console.log(`\n${t}`)

console.log('Configurações Financeiras — somente o nome legível\n')

const TAB = src('src/components/gerenciamentoComponents/ProdutosTab.tsx')

// O mestre real que motivou a correção.
const SERVICO = { id: 19, name: 'Apostilamento de Tradução', code: 'APOSTILAMENTO_TRADUCAO', publicCode: 'SRV-8' }
const opcao = mestreSelecionavel('servico', SERVICO)
const config = mestreDaConfiguracao({
  id: 7, nome: 'config antiga',
  mestre: { origem: 'servico', codigo: 'APOSTILAMENTO_TRADUCAO', nome: 'Apostilamento de Tradução', publicCode: 'SRV-8' },
})

// ── 1) A função canônica devolve SÓ o nome ─────────────────────────────────
secao('1) Função canônica de apresentação')

ok('devolve exclusivamente o nome legível', nomeExibidoDoMestre(opcao) === 'Apostilamento de Tradução', nomeExibidoDoMestre(opcao))
ok('não devolve o código público', !nomeExibidoDoMestre(opcao).includes('SRV-8'))
ok('não devolve a chave estrutural', !nomeExibidoDoMestre(opcao).includes('APOSTILAMENTO_TRADUCAO'))
ok('não devolve separador técnico (— ou ·)', !/[—·]/.test(nomeExibidoDoMestre(opcao)))
ok('mestre da configuração também devolve só o nome', nomeExibidoDoMestre(config) === 'Apostilamento de Tradução')
ok('sem mestre resolvido, cai no nome próprio da config (ainda é NOME)', nomeExibidoDoMestre(mestreDaConfiguracao({ id: 1, nome: 'Honorário legado' })) === 'Honorário legado')

// os campos ficam SEPARADOS — nada pré-concatenado chega à camada visual
ok('sourceId preservado (vínculo)', opcao.sourceId === 19)
ok('sourceType preservado', opcao.sourceType === 'servico')
ok('sourceCode preservado, separado', opcao.sourceCode === 'SRV-8')
ok('masterKey preservada, separada', opcao.masterKey === 'APOSTILAMENTO_TRADUCAO')
ok('displayName é campo próprio', opcao.displayName === 'Apostilamento de Tradução')

// ── 2) Busca técnica preservada ────────────────────────────────────────────
secao('2) Dado pesquisável ≠ dado exibido')

ok('busca por SRV-n encontra', combinaComBusca(opcao, 'SRV-8'))
ok('busca por SRV-n é indiferente a maiúscula', combinaComBusca(opcao, 'srv-8'))
ok('busca pela chave estrutural encontra', combinaComBusca(opcao, 'APOSTILAMENTO_TRADUCAO'))
ok('busca por parte da chave encontra', combinaComBusca(opcao, 'traducao'))
ok('busca pelo nome encontra', combinaComBusca(opcao, 'Apostilamento'))
ok('busca pela origem encontra', combinaComBusca(opcao, 'servico'))
ok('busca por termo inexistente não encontra', !combinaComBusca(opcao, 'zzz-inexistente'))
ok('busca vazia devolve tudo', combinaComBusca(opcao, '   '))
ok('os termos buscáveis incluem o que a tela NÃO exibe', termosBuscaveisDoMestre(opcao).includes('srv-8') && termosBuscaveisDoMestre(opcao).includes('apostilamento_traducao'))
ok('a busca na config também acha por SRV-n', combinaComBusca(config, 'SRV-8'))

// ── 3) A tela não monta concatenação em ponto nenhum ───────────────────────
secao('3) Nenhum ponto visual concatena código + nome')

ok('não existe template `${publicCode} — ${name}`', !/\$\{[a-zA-Z.?]*publicCode\}\s*—/.test(TAB))
ok('não existe render de "· código" no seletor', !/·\s*\{[a-zA-Z.?]*(code|codigo)\b/.test(TAB))
ok('não existe subtítulo "Chave:"', !/Chave:/.test(TAB))
ok('publicCode não é renderizado em JSX', !/\{[^}]*\bpublicCode\b[^}]*\}\s*(—|·)/.test(TAB))
ok('a listagem usa a função canônica', /<div className="font-medium text-white">\{nomeExibidoDoMestre\(mestreDaConfiguracao\(p\)\)\}<\/div>/.test(TAB))
ok('o valor selecionado usa a função canônica', /<span className="text-white">\{nomeExibidoDoMestre\(masterSelecionado\)\}<\/span>/.test(TAB))
ok('a opção do dropdown usa a função canônica', /onClick=\{\(\) => selecionarMaster\(m\)\}[\s\S]{0,180}\{nomeExibidoDoMestre\(m\)\}/.test(TAB))
ok('a seleção grava displayName puro no formulário', /nome: nomeExibidoDoMestre\(m\)/.test(TAB))
ok('não há correção por substring/replace do código', !/replace\((\/SRV|['"]SRV)/.test(TAB) && !/\.substring\(/.test(TAB))
ok('não há ocultação por CSS (hidden/sr-only sobre o código)', !/sr-only|visibility:\s*hidden/.test(TAB))

// Nenhum literal SRV- sobrou no CÓDIGO. Comentários explicam o defeito
// corrigido e devem continuar citando "SRV-8" — quem lê o arquivo precisa saber
// o que não pode voltar. O que não pode existir é no código executável.
const semComentarios = TAB
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '')
ok('nenhum literal "SRV-" no código executável', !/SRV-/.test(semComentarios))
ok('nenhum literal de chave estrutural no código executável', !/SRV_[A-Z]/.test(semComentarios))

// ── 4) Modais: criação, edição, exclusão ───────────────────────────────────
secao('4) Modais não vazam identificador')

// O bloco do modal começa no rótulo "(mestre existente)" e termina no fim do form.
const modal = TAB.split('(mestre existente)')[1]?.slice(0, 2600) ?? ''
ok('o bloco do seletor foi localizado', modal.length > 100)
ok('modal de criação/edição não escreve código', !/\{[a-zA-Z.?]*\.sourceCode\}/.test(modal))
ok('modal de criação/edição não escreve chave', !/\{[a-zA-Z.?]*\.masterKey\}/.test(modal))
ok('na edição o campo é somente leitura (sem input de nome)', !/<input[^>]*value=\{form\.nome\}/.test(TAB))
ok('o título do modal de exclusão usa só o nome', /titulo=\{`Excluir Configuração Financeira · \$\{modalExcluir\.mestre\?\.nome \|\| modalExcluir\.nome\}`\}/.test(TAB))
ok('o modal de exclusão não renderiza publicCode nem chave', (() => {
  const m = src('src/components/gerenciamentoComponents/ExclusaoDefinitivaModal.tsx')
  return !/publicCode/.test(m) && !/SRV[-_]/.test(m)
})())

// o vínculo continua sendo o ID canônico
ok('o value do vínculo continua sendo o sourceId', /masterId: String\(m\.sourceId\)/.test(TAB))
ok('a comparação do selecionado é por sourceId', /String\(m\.sourceId\) === form\.masterId/.test(TAB))

// ── 5) Busca da tela ligada nos termos técnicos ────────────────────────────
secao('5) A busca da tela usa os termos, não o exibido')

ok('a listagem filtra por combinaComBusca', /combinaComBusca\(mestreDaConfiguracao\(p\), q\)/.test(TAB))
ok('o seletor filtra por combinaComBusca', /arr\.filter\(\(m\) => combinaComBusca\(m, q\)\)/.test(TAB))
ok('o placeholder ainda oferece busca por código', /pelo nome\/c[óo]digo/.test(TAB))

// ── 6) Catálogo de Serviços PRESERVADO ─────────────────────────────────────
secao('6) O cadastro de origem continua exibindo código')

const servicoBruto = {
  id: 19, publicCode: 'SRV-8', name: 'Apostilamento de Tradução', descricao: null,
  itemCatalogoId: 40, aplicacaoGlobal: true, ativo: true,
  itemCatalogo: { id: 40, natureza: 'SERVICO', unidade: 'UNIDADE', categoriaId: null, _count: { tiposDocumento: 0, produtos: 1, servicos: 1, precos: 0 } },
} as unknown as ServicoBruto
const linha = unificarCatalogo({ servicos: [servicoBruto], itens: [] })[0]
ok('o Catálogo continua levando SRV-n para a coluna Código', linha?.codigo === 'SRV-8')
ok('o Catálogo mantém o nome em campo separado', linha?.nome === 'Apostilamento de Tradução')

const CAT = src('src/components/gerenciamentoComponents/ProdutosServicosTab.tsx')
ok('o Catálogo continua com a coluna Código', /Código<\/th>/.test(CAT))
ok('o Catálogo continua renderizando o código da linha', /\{l\.codigo \?\? '—'\}/.test(CAT))
ok('o Catálogo continua exibindo o código na edição (cadastro de origem)', /<CodigoPublicoField/.test(CAT))

// ── Resultado ──────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(60)}`)
console.log(`Total: ${passou + falhou} | ✅ ${passou} | ❌ ${falhou}`)
if (falhou > 0) {
  console.log('\nFalhas:')
  for (const f of falhas) console.log(`  · ${f}`)
  process.exit(1)
}
console.log('Parametrização identifica pelo nome; a origem guarda o identificador.\n')
