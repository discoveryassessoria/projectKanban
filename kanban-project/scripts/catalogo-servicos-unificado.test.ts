/**
 * GUARDA — Catálogo de Serviços como ÚNICA face do Cadastro Mestre.
 * Rodar: npm run test:catalogo-servicos
 *
 * O que este teste garante:
 *  1. a regra de unificação/comercializável é PURA e não duplica linha;
 *  2. nomenclatura de negócio (sem "Produto", sem natureza eliminada);
 *  3. a tela técnica "Catálogo Mestre" saiu da navegação e do mapa de telas;
 *  4. as URLs antigas continuam resolvendo (redirect por alias);
 *  5. o cadastro mestre segue INTACTO como estrutura técnica interna
 *     (API, dual-write e vínculos preservados — nada de migration destrutiva);
 *  6. a tela oficial não exibe aviso de tela legada e mostra tipo/unidade/
 *     status/vínculos.
 */
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  unificarCatalogo, filtrarCatalogo, contarPorEscopo, somarVinculos,
  ehComercializavel, rotuloTipo, TIPO_ITEM_LABEL, TIPOS_CADASTRAVEIS,
  type ItemMestreBruto, type ServicoBruto,
} from '../lib/gerenciamento/catalogo-servicos'
import { MANAGEMENT_NAVIGATION } from '../src/components/gerenciamentoComponents/managementNavigation'

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..')
const src = (p: string) => readFileSync(join(RAIZ, p), 'utf8')

let passou = 0, falhou = 0
const falhas: string[] = []
const ok = (nome: string, cond: boolean) => {
  if (cond) { passou++; console.log(`  ✅ ${nome}`) }
  else { falhou++; falhas.push(nome); console.log(`  ❌ ${nome}`) }
}
const secao = (t: string) => console.log(`\n${t}`)

console.log('Catálogo de Serviços — face única do Cadastro Mestre\n')

// ── 1) Unificação sem duplicar e sem inventar registro ──────────────────────
secao('1) Unificação das duas origens do MESMO mestre')

const svc = (o: Partial<ServicoBruto> & { id: number; name: string }): ServicoBruto =>
  ({ ativo: true, ...o })
const item = (o: Partial<ItemMestreBruto> & { id: number; name: string; natureza: string }): ItemMestreBruto =>
  ({ code: `T${o.id}`, ativo: true, ...o })

// ponto-e-vírgula obrigatório: a linha seguinte abre um bloco de escopo `{`, e sem
// ele o parser leria `({...})` como lista de parâmetros de outra arrow function.
const conta = (c: Partial<{ tiposDocumento: number; produtos: number; servicos: number; precos: number }>) =>
  ({ tiposDocumento: 0, produtos: 0, servicos: 0, precos: 0, ...c });

{
  // serviço com espelho no mestre (id 100) + o próprio espelho vindo do mestre
  const servicos = [svc({
    id: 1, name: 'Tradução Juramentada', publicCode: 'SRV-1', itemCatalogoId: 100,
    itemCatalogo: {
      id: 100, natureza: 'SERVICO', unidade: 'PAGINA',
      categoriaId: 7, categoria: { id: 7, nome: 'Registro Civil' },
      _count: conta({ servicos: 1, produtos: 1, precos: 2 }),
    },
  })]
  const itens = [
    item({ id: 100, name: 'Tradução Juramentada', natureza: 'SERVICO', unidade: 'PAGINA', _count: conta({ servicos: 1, produtos: 1, precos: 2 }) }),
    item({ id: 200, name: 'Certidão de Nascimento', natureza: 'DOCUMENTO', unidade: 'DOCUMENTO', _count: conta({ tiposDocumento: 3 }) }),
    item({ id: 300, name: 'Taxa consular', natureza: 'TAXA', unidade: 'PROCESSO', _count: conta({ produtos: 1, precos: 1 }) }),
  ]
  const linhas = unificarCatalogo({ servicos, itens })

  ok('espelho do serviço NÃO vira segunda linha (dedup estrutural)', linhas.length === 3)
  ok('serviço entra pela origem operacional', linhas.some((l) => l.origem === 'servico' && l.id === 1 && l.codigo === 'SRV-1'))
  ok('item técnico entra pela origem do mestre', linhas.some((l) => l.origem === 'item' && l.id === 200))
  ok('chave de renderização nunca colide entre origens', new Set(linhas.map((l) => l.chave)).size === 3)
  ok('itemCatalogoId sempre aponta para o mestre técnico',
    linhas.find((l) => l.origem === 'servico')!.itemCatalogoId === 100 &&
    linhas.find((l) => l.id === 200)!.itemCatalogoId === 200)
  ok('unidade e vínculos vêm do mestre (nada de segunda contagem)',
    linhas.find((l) => l.origem === 'servico')!.unidade === 'PAGINA' &&
    linhas.find((l) => l.origem === 'servico')!.vinculos === 3)
  ok('vínculo não conta a própria projeção do serviço', somarVinculos(conta({ servicos: 1, produtos: 1 })) === 1)
  ok('serviço sem espelho ainda aparece', unificarCatalogo({ servicos: [svc({ id: 9, name: 'Assessoria' })] }).length === 1)
  ok('item de natureza SERVICO sem serviço projetado aparece como item (honorário migrado)',
    unificarCatalogo({ itens: [item({ id: 400, name: 'Honorários Itália', natureza: 'SERVICO', _count: conta({ produtos: 1 }) })] })
      .every((l) => l.origem === 'item' && l.tipo === 'Serviço'))
}

// ── 2) Naturezas eliminadas: preservadas no banco, fora da tela ─────────────
secao('2) Estruturas eliminadas ficam no dado histórico, não na tela')
{
  const itens = [
    item({ id: 1, name: 'Produto legado', natureza: 'PRODUTO', _count: conta({ precos: 4 }) }),
    item({ id: 2, name: 'Honorário legado', natureza: 'HONORARIO', _count: conta({ produtos: 1 }) }),
    item({ id: 3, name: 'Taxa', natureza: 'TAXA', _count: conta({ precos: 1 }) }),
  ]
  const linhas = unificarCatalogo({ itens })
  ok('PRODUTO/HONORARIO não são exibidos', linhas.length === 1 && linhas[0].id === 3)
  ok('nenhum rótulo de negócio chamado "Produto"', !Object.values(TIPO_ITEM_LABEL).includes('Produto'))
  ok('tipos cadastráveis não incluem estrutura eliminada',
    !TIPOS_CADASTRAVEIS.includes('PRODUTO' as never) && !TIPOS_CADASTRAVEIS.includes('HONORARIO' as never))
  ok('natureza desconhecida não vaza código cru na tela', rotuloTipo('PRODUTO') === '—' && rotuloTipo(null) === '—')
}

// ── 3) Comercializável é regra ESTRUTURAL (nunca por nome) ──────────────────
secao('3) "Comercializável pertinente" por estrutura')
{
  ok('serviço é comercializável por definição', ehComercializavel('SERVICO', conta({})))
  ok('item com configuração financeira é comercializável', ehComercializavel('DOCUMENTO', conta({ produtos: 1 })))
  ok('item com preço na Tabela de Valores é comercializável', ehComercializavel('TAXA', conta({ precos: 1 })))
  ok('documento só documental é técnico', !ehComercializavel('DOCUMENTO', conta({ tiposDocumento: 5 })))

  const linhas = unificarCatalogo({
    itens: [
      item({ id: 1, name: 'Certidão', natureza: 'DOCUMENTO', _count: conta({ tiposDocumento: 2 }) }),
      item({ id: 2, name: 'Taxa consular', natureza: 'TAXA', _count: conta({ precos: 1 }) }),
    ],
    servicos: [svc({ id: 3, name: 'Apostilamento', itemCatalogo: { id: 5, natureza: 'SERVICO', _count: conta({ servicos: 1 }) } })],
  })
  // REGRA ATUAL: "Comercializáveis" é a família de VENDA (serviço/pacote), não
  // "tudo que tem preço". Taxa e certidão precificadas são itens COBRADOS
  // RELACIONADOS — preço não transforma documento em serviço.
  ok('escopo comercial exibe só serviços e pacotes vendidos', filtrarCatalogo(linhas, { escopo: 'comercial' }).map((l) => l.nome).join(',') === 'Apostilamento')
  ok('itens cobrados relacionados ficam na outra aba', filtrarCatalogo(linhas, { escopo: 'relacionados' }).map((l) => l.nome).sort().join(',') === 'Certidão,Taxa consular')
  ok('escopo todos não perde nenhuma linha', filtrarCatalogo(linhas, { escopo: 'todos' }).length === 3)
  ok('escopo padrão é o comercial', filtrarCatalogo(linhas).length === 1)
  const c = contarPorEscopo(linhas)
  ok('contagem por escopo fecha com o total', c.comercial + c.relacionados === c.todos && c.todos === 3)
  ok('busca acento-insensível por nome', filtrarCatalogo(linhas, { escopo: 'todos', busca: 'certidao' }).length === 1)
  ok('busca alcança o tipo de negócio', filtrarCatalogo(linhas, { escopo: 'todos', busca: 'taxa' }).length === 1)
}

// ── 4) Navegação: a tela técnica saiu, a URL antiga sobreviveu ──────────────
secao('4) Navegação e compatibilidade de URL')
{
  const itens = MANAGEMENT_NAVIGATION.flatMap((g) => g.children ?? [])
  ok('nenhum item de menu com a key catalogmestre', !itens.some((i) => i.key === 'catalogmestre'))
  ok('nenhum rótulo "Catálogo Mestre" no menu', !itens.some((i) => /Cat[aá]logo Mestre/.test(i.label)))
  const servicos = MANAGEMENT_NAVIGATION.find((g) => g.key === 'grp_servicos')
  ok('Catálogo de Serviços é item ativo de Serviços',
    !!servicos?.children?.some((i) => i.key === 'products' && i.label === 'Catálogo de Serviços' && i.status === 'active'))
  ok('a busca do menu alcança o cadastro mestre pela tela oficial',
    !!servicos?.children?.find((i) => i.key === 'products')?.keywords?.includes('mestre'))

  const page = src('src/app/administrator/page.tsx')
  ok('tela técnica fora do mapa TELAS', !/^\s*catalogmestre:\s*\w/m.test(page))
  ok('componente da tela técnica não é mais importado', !/CatalogoMestreTab/.test(page))
  ok('alias ?screen=catalogmestre → products', /catalogmestre:\s*"products"/.test(page))
  ok('alias ?screen=honorariums → products', /honorariums:\s*"products"/.test(page))
  ok('deep-link ?screen= segue sendo o mecanismo de rota', /\?screen=/.test(page))
}

// ── 5) Código morto removido, estrutura técnica preservada ──────────────────
secao('5) Código morto fora; cadastro mestre intacto')
{
  ok('CatalogoMestreTab.tsx removido', !existsSync(join(RAIZ, 'src/components/gerenciamentoComponents/CatalogoMestreTab.tsx')))
  ok('API do cadastro mestre PRESERVADA (estrutura técnica interna)',
    existsSync(join(RAIZ, 'src/app/api/gerenciamento/catalogo-mestre/route.ts')) &&
    existsSync(join(RAIZ, 'src/app/api/gerenciamento/catalogo-mestre/[id]/route.ts')))
  ok('exclusão definitiva do item preservada (ADMIN)',
    existsSync(join(RAIZ, 'src/app/api/gerenciamento/catalogo-mestre/[id]/exclusao-definitiva/route.ts')))

  const sync = src('src/services/catalogo-sync.ts')
  ok('dual-write serviço → mestre intacto', /sincronizarItemDeServico/.test(sync) && /itemCatalogo\.upsert/.test(sync))

  const rota = src('src/app/api/gerenciamento/produtos-servicos/route.ts')
  ok('GET de serviços traz o espelho do mestre (aditivo, sem migration)',
    /include:\s*\{[\s\S]*itemCatalogo:/.test(rota) && /_count:/.test(rota))
  ok('criação de serviço continua criando o mestre e a config na MESMA transação',
    /\$transaction/.test(rota) && /sincronizarItemDeServico/.test(rota) && /garantirConfigFinanceiraDeItem/.test(rota))

  // nenhuma migration nova: a migração é só de exposição
  const mestre = src('src/app/api/gerenciamento/catalogo-mestre/[id]/route.ts')
  ok('PUT do mestre segue aditivo (sem apagar campo omitido)', /if \(b\.\w+ !== undefined\)/.test(mestre))
  ok('DELETE do mestre segue recusando item em uso', /Item em uso/.test(mestre))
}

// ── 6) A tela oficial é honesta e completa ─────────────────────────────────
secao('6) Tela oficial: sem aviso legado, com tipo/unidade/status/vínculos')
{
  const tab = src('src/components/gerenciamentoComponents/ProdutosServicosTab.tsx')
  ok('não exibe "Tela legada em migração"', !/Tela legada/.test(tab))
  ok('título de negócio é Catálogo de Serviços', /Catálogo de Serviços<\/h2>/.test(tab))
  ok('lê as duas origens do mesmo mestre', /produtos-servicos/.test(tab) && /catalogo-mestre/.test(tab))
  ok('não expõe "Produto" ao usuário', !/>\s*Produtos?\s*</.test(tab))
  for (const coluna of ['Tipo', 'Unidade', 'Vínculos', 'Status']) {
    ok(`coluna "${coluna}" presente`, new RegExp(`>${coluna}</th>`).test(tab))
  }
  ok('cadastro escolhe o tipo (serviço × item técnico) sem cadastro paralelo', /TIPOS_CADASTRAVEIS/.test(tab))
  ok('inativação por status (não por exclusão) está disponível', /checked=\{ativo\}/.test(tab))
  ok('regra de unificação vem da fonte única pura', /from '@\/lib\/gerenciamento\/catalogo-servicos'/.test(tab))
  ok('nenhuma chave técnica interna é enviada pelo frontend', !/\bcode:\s*(name|form|code)/.test(tab))
}

console.log(`\n${passou} passaram, ${falhou} falharam`)
if (falhou > 0) { console.log('FALHAS: ' + falhas.join('; ')); process.exit(1) }
console.log('Catálogo de Serviços: face única do cadastro mestre validada ✅')
