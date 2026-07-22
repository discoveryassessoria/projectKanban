// scripts/taxa-aplicabilidade.test.ts
// ============================================================================
// GUARDA — Etapa "Aplicabilidade" da TAXA DE PAGAMENTO.
//
// Regra da entrega: Moedas e Países deixam de ser texto/CSV. São multiselects
// reais sobre o cadastro oficial, persistidos por RELACIONAMENTO (TaxaPagamentoMoeda
// / TaxaPagamentoPais); Serviços seguem em array de IDs reais. Vazio = sem restrição.
//
// (1) seleção pura: múltiplos, sem texto livre, sem CSV, sem duplicidade
// (2) validação contra o cadastro: inexistente e inativo
// (3) persistência: vínculos + projeção legada (motor intacto)
// (4) interface: multiselect padrão, chips, busca, selecionar todas/limpar
// (5) backend e migration aditiva/idempotente
// ============================================================================
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import {
  idsSelecionados, selecaoDoBody, eixosPresentes, resolverAplicabilidadeTaxa, vinculosTaxaParaCriar,
} from '../lib/financeiro/taxa-aplicabilidade'

const RAIZ = join(__dirname, '..')
let passou = 0, falhou = 0
const ok = (n: string, c: boolean) => { if (c) { passou++; console.log(`  ✓ ${n}`) } else { falhou++; console.log(`  ✗ ${n}`) } }
const sec = (t: string) => console.log(`\n${t}`)

// ── stub do Prisma: 1 query por cadastro, nunca N+1 ─────────────────────────
let chamadas = 0
const CADASTRO = {
  moedas: [{ id: 1, code: 'BRL', ativo: true }, { id: 2, code: 'EUR', ativo: true }, { id: 3, code: 'USD', ativo: true }, { id: 4, code: 'JPY', ativo: false }],
  paises: [{ id: 10, countryKey: 'brasil', ativo: true }, { id: 11, countryKey: 'portugal', ativo: true }, { id: 12, countryKey: 'polonia', ativo: false }],
  servicos: [{ id: 30, ativo: true }, { id: 31, ativo: true }, { id: 32, ativo: false }],
}
const seletor = <T extends { id: number }>(fonte: T[]) => ({
  findMany: async ({ where }: { where: { id: { in: number[] } } }) => {
    chamadas++
    return fonte.filter((r) => where.id.in.includes(r.id))
  },
})
const db = {
  moedaCadastro: seletor(CADASTRO.moedas),
  catalogoPais: seletor(CADASTRO.paises),
  servicoProduto: seletor(CADASTRO.servicos),
} as never

async function main() {
sec('1 — seleção: múltipla, só id, sem CSV, sem duplicidade')
{
  ok('seleciona várias moedas', JSON.stringify(idsSelecionados([1, 2, 3])) === '[1,2,3]')
  ok('seleciona vários países', JSON.stringify(idsSelecionados([10, 11])) === '[10,11]')
  ok('não duplica valores', JSON.stringify(idsSelecionados([1, 1, 2, 2, 1])) === '[1,2]')

  // o formato antigo da tela (textbox "BRL, EUR" / "BR, PT") é rejeitado por construção
  ok('recusa string CSV de moedas', JSON.stringify(idsSelecionados('BRL,EUR' as unknown)) === '[]')
  ok('recusa string CSV de países', JSON.stringify(idsSelecionados('BR, PT' as unknown)) === '[]')
  ok('recusa array de códigos de texto', JSON.stringify(idsSelecionados(['BRL', 'EUR'])) === '[]')
  ok('recusa id não inteiro/negativo', JSON.stringify(idsSelecionados([1.5, -2, 0, 3])) === '[3]')

  // "remover chip" = a lista volta sem o id
  ok('remover moeda tira só aquele id', JSON.stringify(idsSelecionados([1, 2, 3].filter((x) => x !== 2))) === '[1,3]')
  ok('remover país tira só aquele id', JSON.stringify(idsSelecionados([10, 11].filter((x) => x !== 10))) === '[11]')

  const s = selecaoDoBody({ moedasIds: [1, 2], paisesIds: [10], servicosIds: [30, 31] })
  ok('selecaoDoBody lê os 3 eixos por id', s.moedas.length === 2 && s.paises.length === 1 && s.servicos.length === 2)
  ok('array de texto legado não é entrada de escrita', selecaoDoBody({ moedasAplicaveis: ['BRL'], paises: ['brasil'] }).moedas.length === 0)

  const p = eixosPresentes({ moedasIds: [] })
  ok('eixo presente e vazio ≠ eixo ausente', p.moedas === true && p.paises === false)

  const v = vinculosTaxaParaCriar({ moedas: [1], paises: [], servicos: [] })
  ok('vazio = sem restrição (não cria vínculo)', v.paisesPermitidos === undefined)
  ok('selecionado vira vínculo real', JSON.stringify(v.moedasVinculadas) === '{"create":[{"moedaId":1}]}')
}

sec('2 — backend valida contra o cadastro (nunca confia no frontend)')
{
  chamadas = 0
  const r = await resolverAplicabilidadeTaxa({ moedasIds: [1, 2], paisesIds: [10], servicosIds: [30] }, db)
  ok('seleção válida passa sem erro', r.erros.length === 0)
  ok('sem N+1: 1 query por cadastro', chamadas === 3)
  ok('projeta moedas por code', JSON.stringify(r.projecao.moedasAplicaveis) === '["BRL","EUR"]')
  ok('projeta países por countryKey', JSON.stringify(r.projecao.paises) === '["brasil"]')
  ok('projeta serviços por id', JSON.stringify(r.projecao.servicos) === '[30]')

  const moedaInexistente = await resolverAplicabilidadeTaxa({ moedasIds: [999] }, db)
  ok('moeda inexistente é rejeitada', moedaInexistente.erros.some((e) => e.campo === 'moedas' && e.mensagem.includes('inexistente')))

  const paisInexistente = await resolverAplicabilidadeTaxa({ paisesIds: [777] }, db)
  ok('país inexistente é rejeitado', paisInexistente.erros.length === 1)

  const moedaInativa = await resolverAplicabilidadeTaxa({ moedasIds: [4] }, db)
  ok('moeda inativa é rejeitada', moedaInativa.erros.some((e) => e.mensagem.includes('inativo')))

  const paisInativo = await resolverAplicabilidadeTaxa({ paisesIds: [12] }, db)
  ok('país inativo é rejeitado', paisInativo.erros.some((e) => e.mensagem.includes('inativo')))

  const servicoInativo = await resolverAplicabilidadeTaxa({ servicosIds: [32] }, db)
  ok('serviço inativo é rejeitado', servicoInativo.erros.some((e) => e.mensagem.includes('inativo')))

  const dup = await resolverAplicabilidadeTaxa({ moedasIds: [1, 1, 2] }, db)
  ok('duplicadas são impossíveis (dedup)', dup.selecao.moedas.length === 2 && dup.erros.length === 0)

  chamadas = 0
  const vazio = await resolverAplicabilidadeTaxa({ moedasIds: [], paisesIds: [], servicosIds: [] }, db)
  ok('nenhuma seleção é válida (sem restrição)', vazio.erros.length === 0)
  ok('vazio não consulta o banco', chamadas === 0)
  ok('vazio projeta arrays vazios', vazio.projecao.moedasAplicaveis.length === 0 && vazio.projecao.paises.length === 0)

  const uma = await resolverAplicabilidadeTaxa({ moedasIds: [1] }, db)
  ok('uma moeda é válida', uma.erros.length === 0 && uma.projecao.moedasAplicaveis.length === 1)
  const varias = await resolverAplicabilidadeTaxa({ moedasIds: [1, 2, 3], paisesIds: [10, 11] }, db)
  ok('várias moedas e países são válidos', varias.erros.length === 0 && varias.projecao.paises.length === 2)
}

sec('3 — interface: multiselect real, nunca textbox')
{
  const tabRaw = readFileSync(join(RAIZ, 'src/components/gerenciamentoComponents/TaxasPagamentoTab.tsx'), 'utf8')
  const tab = tabRaw.split('\n').filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*') && !l.trim().startsWith('/*')).join('\n')

  ok('reutiliza o MultiSelect padrão (sem componente novo)', tab.includes("from './pagamentoUI'") && tab.includes('MultiSelect'))
  ok('moedas viraram multiselect', /Campo label="Moedas"[\s\S]{0,400}<MultiSelect/.test(tab))
  ok('países viraram multiselect', /Campo label="Países"[\s\S]{0,400}<MultiSelect/.test(tab))
  ok('serviços usam o mesmo multiselect', /Campo label="Serviços"[\s\S]{0,400}<MultiSelect/.test(tab))

  ok('sem campo "(vírgula)"', !tab.includes('(vírgula)'))
  ok('sem parsing de texto por vírgula', !tab.includes("split(',')"))
  ok('sem placeholder "BRL, EUR"', !tab.includes('BRL, EUR') && !tab.includes('BR, PT'))
  ok('sem join(", ") em moeda/país', !/f\.(paises|moedasAplicaveis)\.join/.test(tab))

  ok('placeholder vazio = "Todas as moedas"', tab.includes('Todas as moedas'))
  ok('placeholder vazio = "Todos os países"', tab.includes('Todos os países'))
  ok('busca interna ativada', tab.includes('buscaPlaceholder="Filtrar moeda…"') && tab.includes('buscaPlaceholder="Filtrar país…"'))
  ok('selecionar todas / limpar ativados', /Campo label="Moedas"[\s\S]{0,400}acoes/.test(tab))

  ok('payload por IDs', tab.includes('moedasIds') && tab.includes('paisesIds') && tab.includes('servicosIds'))
  ok('edição hidrata dos vínculos reais', tab.includes('moedasVinculadas') && tab.includes('paisesPermitidos'))
  ok('cadastro de países carregado uma vez (com a listagem)', tab.includes('setPaises(d.paises'))

  const ui = readFileSync(join(RAIZ, 'src/components/gerenciamentoComponents/pagamentoUI.tsx'), 'utf8')
  ok('MultiSelect é o componente compartilhado', ui.includes('export function MultiSelect'))
  ok('chips removíveis', ui.includes('Remover ${o.label}'))
  ok('checkbox por opção', ui.includes('aria-multiselectable') && ui.includes('role="option"'))
  ok('scroll interno na lista', ui.includes('overflow-y-auto'))
  ok('busca é opt-in e só filtra a lista', ui.includes('busca = false') && ui.includes('if (!busca || !q) return opcoes'))
  ok('ações selecionar todas / limpar', ui.includes('Selecionar todas') && ui.includes('Limpar seleção'))
}

sec('4 — backend, projeção legada e migration aditiva')
{
  const route = readFileSync(join(RAIZ, 'src/app/api/gerenciamento/taxas-pagamento/route.ts'), 'utf8')
  const put = readFileSync(join(RAIZ, 'src/app/api/gerenciamento/taxas-pagamento/[id]/route.ts'), 'utf8')
  const campos = readFileSync(join(RAIZ, 'src/app/api/gerenciamento/taxas-pagamento/campos.ts'), 'utf8')

  ok('GET carrega moedas e países do cadastro', route.includes('moedaCadastro') && route.includes('catalogoPais'))
  ok('GET devolve a aplicabilidade resolvida', route.includes('INCLUDE_APLICABILIDADE_TAXA'))
  ok('POST valida ids antes de gravar', route.includes('resolverAplicabilidadeTaxa') && route.includes('aplic.erros.length'))
  ok('POST grava vínculos reais', route.includes('vinculosTaxaParaCriar'))
  ok('PUT valida ids antes de gravar', put.includes('resolverAplicabilidadeTaxa'))
  ok('PUT regrava só os eixos declarados', put.includes('eixosPresentes') && put.includes('regravarVinculosTaxa'))
  ok('POST/PUT gravam a projeção legada', route.includes('aplic.projecao') && put.includes('projecao.moedasAplicaveis'))
  ok('campos.ts não escreve mais texto em país/moeda', !campos.includes('paises: listaStr(b.paises)') && !campos.includes('moedasAplicaveis: listaStr'))

  const motor = readFileSync(join(RAIZ, 'lib/financeiro/charge-calculation-service.ts'), 'utf8')
  ok('motor de cálculo intacto (lê o array projetado)', motor.includes('t.moedasAplicaveis'))

  const dir = join(RAIZ, 'prisma/migrations/20260803000000_taxa_aplicabilidade_relacional/migration.sql')
  ok('migration aditiva existe', existsSync(dir))
  const sql = readFileSync(dir, 'utf8')
  ok('migration não é destrutiva', !/DROP\s+(TABLE|COLUMN)/i.test(sql) && !/DELETE\s+FROM/i.test(sql) && !/TRUNCATE/i.test(sql))
  ok('migration é idempotente', (sql.match(/IF NOT EXISTS/g) || []).length >= 6 && (sql.match(/DO NOTHING/g) || []).length >= 3)
  ok('backfill só converte o que casa com o cadastro', sql.includes('JOIN "MoedaCadastro"') && sql.includes('JOIN "CatalogoPais"'))
  ok('colunas legadas preservadas', !/ALTER TABLE "TaxaPagamento" DROP/i.test(sql))

  const schema = readFileSync(join(RAIZ, 'prisma/schema.prisma'), 'utf8')
  ok('tabelas de vínculo no schema', ['TaxaPagamentoMoeda', 'TaxaPagamentoPais'].every((m) => schema.includes(`model ${m} {`)))
  ok('unicidade impede duplicidade no banco', schema.includes('@@unique([taxaId, moedaId])') && schema.includes('@@unique([taxaId, paisId])'))
  ok('arrays legados preservados no schema', schema.includes('moedasAplicaveis String[]') && schema.includes('paises          String[]'))

  const aplicador = readFileSync(join(RAIZ, 'scripts/prod-apply-cadastros-aditivas.mjs'), 'utf8')
  ok('migration registrada no aplicador do build', aplicador.includes('20260803000000_taxa_aplicabilidade_relacional'))
  ok('sentinelas das novas tabelas', aplicador.includes("'TaxaPagamentoMoeda'") && aplicador.includes("'TaxaPagamentoPais'"))
}

console.log(`\n${'='.repeat(60)}`)
console.log(`Taxa — Aplicabilidade relacional: ${passou} passaram, ${falhou} falharam`)
console.log('='.repeat(60))
if (falhou > 0) process.exit(1)
}

main().catch((e) => { console.error(e); process.exit(1) })
