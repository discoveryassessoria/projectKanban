// scripts/lancamento-financeiro.test.ts
// ============================================================================
// Núcleo do lançamento financeiro (Custo e Receita): total, parcelamento,
// arredondamento e validação por campo. Tudo PURO — sem banco, sem rede.
//
// Também é o guard do LEGADO: o formulário antigo não pode voltar, nem por
// arquivo, nem por texto ("Todos os tipos", "Produto"), nem por <select> nativo
// no fluxo oficial.
// ============================================================================
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import {
  calcularTotal, gerarParcelas, parcelasSomamTotal, validarLancamento, temErro, dataLocal, centavos,
} from '@/lib/financeiro/lancamento/calculo'
import { agruparPorCategoria, type ItemCatalogoOpcao } from '@/src/components/financeiro/v3/lancamento/SeletorItemCatalogo'

let ok = 0, fail = 0
const chk = (c: boolean, m: string) => { if (c) { ok++; console.log('  ✅', m) } else { fail++; console.log('  ❌', m) } }
const sec = (t: string) => console.log(`\n── ${t}`)

const RAIZ = process.cwd()
const base = {
  natureza: 'CUSTO' as const, itemId: 1, quantidade: 1, valorUnitario: 100, moeda: 'BRL',
  desconto: 0, acrescimo: 0, nParcelas: 1, primeiroVencimento: '', fornecedorId: null,
}

// ── 1) total ────────────────────────────────────────────────────────────────
sec('1) cálculo do total')
chk(calcularTotal({ quantidade: 3, valorUnitario: 10 }).total === 30, '3 × 10 = 30')
chk(calcularTotal({ quantidade: 2, valorUnitario: 50, desconto: 20 }).total === 80, 'desconto subtrai')
chk(calcularTotal({ quantidade: 2, valorUnitario: 50, acrescimo: 15 }).total === 115, 'acréscimo soma')
chk(calcularTotal({ quantidade: 2, valorUnitario: 50, desconto: 20, acrescimo: 15 }).total === 95, 'desconto e acréscimo juntos')
// nunca arredondar antes de multiplicar
chk(calcularTotal({ quantidade: 3, valorUnitario: 0.335 }).total === 1.01, '3 × 0,335 = 1,01 (arredonda no fim)')
chk(calcularTotal({ quantidade: 0, valorUnitario: 100 }).total === 0, 'quantidade zero zera o total')
chk(calcularTotal({ quantidade: 1, valorUnitario: 100, desconto: -50 }).desconto === 0, 'desconto negativo é tratado como zero')
chk(centavos(10.005) === 10.01 && centavos(1 / 3) === 0.33, 'arredondamento em centavos')

// ── 2) parcelamento ─────────────────────────────────────────────────────────
sec('2) parcelamento')
const p3 = gerarParcelas({ total: 100, nParcelas: 3, primeiroVencimento: '2026-08-10' })
chk(p3.length === 3, '3 parcelas geradas')
chk(parcelasSomamTotal(p3, 100), 'soma das parcelas = total (partição exata)')
chk(p3[0].valor === 33.33 && p3[2].valor === 33.34, 'resíduo de centavo vai na ÚLTIMA parcela')
chk(p3.map((p) => p.vencimento).join(',') === '2026-08-10,2026-09-10,2026-10-10', 'passo mensal preserva o dia')
const pFim = gerarParcelas({ total: 90, nParcelas: 3, primeiroVencimento: '2026-01-31' })
chk(pFim[1].vencimento === '2026-02-28', '31/01 + 1 mês = 28/02 (não escorrega para março)')
const pDias = gerarParcelas({ total: 60, nParcelas: 3, primeiroVencimento: '2026-08-01', intervaloDias: 15 })
chk(pDias.map((p) => p.vencimento).join(',') === '2026-08-01,2026-08-16,2026-08-31', 'intervalo em dias respeitado')
chk(gerarParcelas({ total: 100, nParcelas: 1, primeiroVencimento: '2026-08-10' }).length === 1, 'parcela única')
chk(gerarParcelas({ total: 100, nParcelas: 3, primeiroVencimento: 'xx' }).length === 0, 'data inválida não gera parcelas')
chk(parcelasSomamTotal(gerarParcelas({ total: 10, nParcelas: 7, primeiroVencimento: '2026-08-10' }), 10), '10 em 7× ainda soma exato')
chk(dataLocal('2026-08-10')?.getDate() === 10, 'data lida no fuso local (não desloca o dia)')

// ── 3) validação ────────────────────────────────────────────────────────────
sec('3) validação por campo')
const semItem = validarLancamento({ ...base, itemId: null })
chk(semItem.some((p) => p.campo === 'item' && p.severidade === 'erro'), 'item obrigatório')
chk(temErro(semItem), 'sem item o salvar fica bloqueado')
chk(validarLancamento({ ...base, itemAtivo: false }).some((p) => p.campo === 'item' && p.severidade === 'erro'), 'item inativo é bloqueado')
chk(validarLancamento({ ...base, quantidade: 0 }).some((p) => p.campo === 'quantidade'), 'quantidade zero reprova')
chk(validarLancamento({ ...base, quantidade: -2 }).some((p) => p.campo === 'quantidade'), 'quantidade negativa reprova')
chk(validarLancamento({ ...base, valorUnitario: 0 }).some((p) => p.campo === 'valorUnitario'), 'valor unitário zero reprova')
chk(validarLancamento({ ...base, moeda: 'GBP' }).some((p) => p.campo === 'moeda'), 'moeda fora da lista reprova')
chk(validarLancamento({ ...base, desconto: 500 }).some((p) => p.campo === 'desconto'), 'desconto maior que o subtotal reprova')
chk(validarLancamento({ ...base, acrescimo: -1 }).some((p) => p.campo === 'acrescimo'), 'acréscimo negativo reprova')
chk(validarLancamento({ ...base, nParcelas: 200 }).some((p) => p.campo === 'nParcelas'), 'acima de 120 parcelas reprova')
chk(validarLancamento({ ...base, nParcelas: 3, primeiroVencimento: '' }).some((p) => p.campo === 'primeiroVencimento'), 'parcelado exige 1º vencimento')
chk(validarLancamento({ ...base, fornecedorObrigatorio: true }).some((p) => p.campo === 'fornecedor' && p.severidade === 'erro'), 'fornecedor obrigatório quando exigido')
chk(!temErro(validarLancamento(base)), 'lançamento mínimo válido não bloqueia')
chk(
  validarLancamento({ ...base, parcelas: [{ numero: 1, vencimento: '2026-08-10', valor: 50 }], nParcelas: 2, primeiroVencimento: '2026-08-10' })
    .some((p) => p.campo === 'parcelas' && p.severidade === 'erro'),
  'soma de parcelas divergente do total reprova',
)
chk(validarLancamento(base).every((p) => p.mensagem.length > 12), 'nenhuma mensagem genérica')

sec('3b) avisos (não bloqueiam)')
const semConfig = validarLancamento({ ...base, temConfig: false })
chk(semConfig.some((p) => p.severidade === 'aviso' && /Configuração Financeira/i.test(p.mensagem)), 'item sem configuração vira aviso')
chk(!temErro(semConfig), 'aviso de configuração não bloqueia o salvar')
chk(validarLancamento({ ...base, valorDaTabela: 80 }).some((p) => p.campo === 'valorUnitario' && p.severidade === 'aviso'), 'valor diferente da Tabela de Valores avisa')
chk(!validarLancamento({ ...base, valorDaTabela: 100 }).some((p) => p.campo === 'valorUnitario' && p.severidade === 'aviso'), 'valor igual ao da Tabela não avisa')
chk(validarLancamento({ ...base, primeiroVencimento: '2020-01-01' }).some((p) => p.severidade === 'aviso' && /venc/i.test(p.mensagem)), 'vencimento passado avisa')
chk(validarLancamento({ ...base, duplicidadeProvavel: true }).some((p) => p.severidade === 'aviso' && /duplicidade/i.test(p.mensagem)), 'duplicidade provável avisa')
chk(validarLancamento({ ...base, pendenciasDaConfig: ['Sem conta contábil de custo'] }).some((p) => /conta contábil/i.test(p.mensagem)), 'pendência da config aparece')

// ── 4) agrupamento do seletor ───────────────────────────────────────────────
sec('4) seletor de item')
const it = (id: number, categoria: string | null, extra: Partial<ItemCatalogoOpcao> = {}): ItemCatalogoOpcao => ({
  id, code: `C${id}`, name: `Item ${id}`, natureza: 'SERVICO', categoria, temConfig: true, temPreco: true, moeda: 'BRL', fornecedorPadraoNome: null, ...extra,
})
const grupos = agruparPorCategoria([it(1, 'Registro civil'), it(2, 'Registro civil'), it(3, 'Tradução'), it(4, null)])
chk(grupos.length === 3, 'resultados agrupados por categoria')
chk(grupos[0].itens.length === 2, 'itens da mesma categoria ficam juntos')
chk(grupos.some((g) => g.categoria === 'Sem categoria'), 'item sem categoria cai em "Sem categoria"')
chk(agruparPorCategoria([]).length === 0, 'lista vazia não gera grupo')

// ── 5) guard do LEGADO ──────────────────────────────────────────────────────
sec('5) legado eliminado')
chk(!existsSync(join(RAIZ, 'src/components/financeiro/v3/LancamentoManualModal.tsx')), 'LancamentoManualModal.tsx não existe mais')

const arquivosTsx = (dir: string): string[] => {
  const saida: string[] = []
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) { if (e !== 'node_modules') saida.push(...arquivosTsx(p)) }
    else if (/\.(tsx|ts)$/.test(e)) saida.push(p)
  }
  return saida
}
const todos = arquivosTsx(join(RAIZ, 'src'))
chk(!todos.some((f) => readFileSync(f, 'utf8').includes('LancamentoManualModal')), 'nenhum import órfão do modal legado')

const FLUXO = [
  'src/components/financeiro/v3/lancamento/LancamentoFinanceiroModal.tsx',
  'src/components/financeiro/v3/lancamento/SeletorItemCatalogo.tsx',
  'src/components/financeiro/v3/lancamento/campos.tsx',
// Comentários fora: os arquivos DOCUMENTAM que substituem o <select> nativo, e
// citar o que se eliminou não é usá-lo. O guard olha o código, não a prosa.
].map((f) => ({ f, src: semComentarios(readFileSync(join(RAIZ, f), 'utf8')) }))

function semComentarios(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}

for (const { f, src } of FLUXO) {
  chk(!/<select[\s>]/i.test(src), `${f.split('/').pop()} — sem <select> nativo`)
  chk(!/Todos os tipos/i.test(src), `${f.split('/').pop()} — sem "Todos os tipos"`)
  chk(!/\bProduto\b/.test(src), `${f.split('/').pop()} — sem o conceito "Produto"`)
}
const modal = FLUXO[0].src
chk(!/NATUREZA_LABEL/.test(modal), 'enum visual de natureza (com "Produto") não existe mais')
chk(!/Item do Cadastro Mestre/.test(modal), 'rótulo legado "Item do Cadastro Mestre" removido')
chk(!/\btipo\b\s*,\s*set[Tt]ipo/.test(modal), 'estado do campo "Tipo" não existe mais')

// fluxo único: só um componente cria custo no processo
const criadores = todos.filter((f) => /LancamentoFinanceiroModal/.test(readFileSync(f, 'utf8')) && !f.endsWith('LancamentoFinanceiroModal.tsx'))
chk(criadores.length === 2, `um único fluxo de criação, usado por Custos e Receitas (${criadores.length} pontos de uso)`)

// ── 6) integração com o motor ───────────────────────────────────────────────
sec('6) contrato com o motor')
const rotaCustos = readFileSync(join(RAIZ, 'src/app/api/financeiro/v3/custos/route.ts'), 'utf8')
chk(/definirCronogramaPagavel/.test(rotaCustos), 'POST /custos define o cronograma quando há parcelas')
chk(/verificarPermissaoCusto\(req, 'criar'\)/.test(rotaCustos), 'criação de custo segue exigindo financeiro.custo_criar')
const rotaItens = readFileSync(join(RAIZ, 'src/app/api/financeiro/v3/itens-catalogo/route.ts'), 'utf8')
chk(/ativo: true/.test(rotaItens), 'catálogo só devolve itens ATIVOS')
chk(/limite/.test(rotaItens) && /take:/.test(rotaItens), 'catálogo é paginado (não carrega tudo)')
const rotaConfig = readFileSync(join(RAIZ, 'src/app/api/financeiro/v3/item-config/route.ts'), 'utf8')
chk(/contaContabilLabel/.test(rotaConfig), 'item-config expõe a conta contábil')
chk(/pendencias/.test(rotaConfig), 'item-config expõe as pendências da configuração')

console.log(`\n${ok} passaram, ${fail} falharam`)
if (fail) process.exit(1)
