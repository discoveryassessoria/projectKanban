/**
 * GUARDA — Aplicação territorial do Serviço + apresentação do Catálogo.
 * Rodar: npm run test:aplicacao-territorial
 *
 * O que este teste garante:
 *  1. as 5 regras do "Todas" (global ≠ "todos os países de hoje");
 *  2. os três estados permitidos e os rótulos exatos da listagem;
 *  3. a modelagem é relacional — nada de texto/CSV, e o legado fica congelado;
 *  4. o filtro territorial (por país e "só global");
 *  5. a separação de famílias do catálogo: certidão nunca parece serviço;
 *  6. o formulário multisseleciona de verdade (chips, checkbox, busca, remoção
 *     individual) e a edição preserva a seleção;
 *  7. migration aditiva, idempotente e sem perda de dados.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  marcarTodas, alternarTodas, alternarPais, removerPais, definirPaises,
  normalizarSelecao, estadoTerritorial, resumoTerritorial, aplicaAoPais,
  validarSelecao, selecaoDoLegado, idsPaises, textoBuscavel,
  ROTULO_TODAS, ROTULO_GLOBAL, ROTULO_SEM_APLICACAO,
  type PaisAplicavel,
} from '../lib/gerenciamento/aplicacao-territorial'
import {
  unificarCatalogo, filtrarCatalogo, contarPorEscopo, agruparParaExibicao,
  grupoDoItem, ehPacote, rotuloTerritorio, ESCOPOS, GRUPO_TITULO,
  type ItemMestreBruto, type ServicoBruto,
} from '../lib/gerenciamento/catalogo-servicos'

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..')
const src = (p: string) => readFileSync(join(RAIZ, p), 'utf8')

let passou = 0, falhou = 0
const falhas: string[] = []
const ok = (nome: string, cond: boolean) => {
  if (cond) { passou++; console.log(`  ✅ ${nome}`) }
  else { falhou++; falhas.push(nome); console.log(`  ❌ ${nome}`) }
}
const secao = (t: string) => console.log(`\n${t}`)

console.log('Aplicação territorial do Serviço + apresentação do Catálogo\n')

const PAISES: PaisAplicavel[] = [
  { id: 1, countryKey: 'italia', countryLabel: 'Itália', nationalityKey: 'italiana', flag: '🇮🇹', ativo: true },
  { id: 2, countryKey: 'espanha', countryLabel: 'Espanha', nationalityKey: 'espanhola', flag: '🇪🇸', ativo: true },
  { id: 3, countryKey: 'portugal', countryLabel: 'Portugal', nationalityKey: 'portuguesa', flag: '🇵🇹', ativo: true },
  { id: 4, countryKey: 'alemanha', countryLabel: 'Alemanha', nationalityKey: 'alema', flag: '🇩🇪', ativo: true },
]

// ── 1) As 5 regras do "Todas" ──────────────────────────────────────────────
secao('1) Regras da opção especial "Todas"')
{
  // Regra 1 — "Todas" significa aplicação global.
  ok('"Todas" é o estado global', estadoTerritorial(marcarTodas()) === 'global')

  // Regra 2 — não cria vínculo individual com todos os países existentes.
  ok('global NÃO materializa vínculo por país', marcarTodas().paisIds.length === 0)

  // Regra 3 — marcar "Todas" limpa as seleções individuais.
  const comTres = { global: false, paisIds: [1, 2, 3] }
  ok('marcar "Todas" limpa a seleção individual', alternarTodas(comTres).paisIds.length === 0 && alternarTodas(comTres).global)

  // Regra 4 — selecionar um país individual desmarca "Todas".
  const saindoDoGlobal = alternarPais(marcarTodas(), 2)
  ok('escolher país desmarca "Todas"', saindoDoGlobal.global === false && saindoDoGlobal.paisIds.join(',') === '2')
  ok('a lista do MultiSelect também desmarca "Todas"', definirPaises(marcarTodas(), [3]).global === false)

  // Regra 5 — país novo já nasce abrangido pelo global (nenhum vínculo a criar).
  const paisNovo = 99
  ok('país cadastrado no futuro já é abrangido por "Todas"', aplicaAoPais(marcarTodas(), paisNovo))
  ok('seleção específica NÃO abrange país novo', !aplicaAoPais({ global: false, paisIds: [1, 2] }, paisNovo))
}

// ── 2) Multisseleção real ──────────────────────────────────────────────────
secao('2) Multisseleção: 1, 2, 3 ou qualquer quantidade, com remoção individual')
{
  let sel = { global: false, paisIds: [] as number[] }
  sel = alternarPais(sel, 1); sel = alternarPais(sel, 2); sel = alternarPais(sel, 3); sel = alternarPais(sel, 4)
  ok('aceita 4 países ao mesmo tempo', sel.paisIds.join(',') === '1,2,3,4')
  ok('remove um item individualmente', removerPais(sel, 2).paisIds.join(',') === '1,3,4')
  ok('clicar de novo no mesmo país remove só ele', alternarPais(sel, 3).paisIds.join(',') === '1,2,4')
  ok('esvaziar a lista NÃO volta para "Todas" sozinho', definirPaises(sel, []).global === false)
  ok('ordem de seleção é preservada', definirPaises(sel, [4, 1]).paisIds.join(',') === '4,1')
  ok('id repetido não duplica', idsPaises([1, 1, 2]).join(',') === '1,2')
  ok('texto livre não vira seleção', idsPaises(['italia', null, -3, 0, true]).length === 0)
  ok('aceita o registro inteiro ({ id })', idsPaises([{ id: 7 }]).join(',') === '7')
}

// ── 3) Estados permitidos e rótulos da listagem ────────────────────────────
secao('3) Estados permitidos e rótulos exatos')
{
  ok('estado global', estadoTerritorial({ global: true, paisIds: [] }) === 'global')
  ok('estado com países', estadoTerritorial({ global: false, paisIds: [1] }) === 'paises')
  ok('estado sem aplicação territorial', estadoTerritorial({ global: false, paisIds: [] }) === 'sem_aplicacao')

  const r = (s: { global: boolean; paisIds: number[] }) => resumoTerritorial(s, PAISES)
  ok('global → "Todos os países"', r({ global: true, paisIds: [] }) === 'Todos os países')
  ok('1 país → nome do país', r({ global: false, paisIds: [1] }) === 'Itália')
  ok('2 países → "Itália + Espanha"', r({ global: false, paisIds: [1, 2] }) === 'Itália + Espanha')
  ok('3 ou mais → "3 países"', r({ global: false, paisIds: [1, 2, 3] }) === '3 países')
  ok('4 países → "4 países"', r({ global: false, paisIds: [1, 2, 3, 4] }) === '4 países')
  ok('sem vínculo → "Sem aplicação territorial"', r({ global: false, paisIds: [] }) === ROTULO_SEM_APLICACAO)
  ok('país removido do cadastro não é inventado', r({ global: false, paisIds: [1, 777] }) === 'Itália')
  ok('rótulos são constantes únicas', ROTULO_GLOBAL === 'Todos os países' && ROTULO_TODAS === 'Todas')
  ok('resumo textual do território segue disponível para exibição', textoBuscavel({ global: false, paisIds: [4] }, PAISES).includes('Alemanha'))
}

// ── 4) Validação e invariante ──────────────────────────────────────────────
secao('4) Validação: os dois modos não convivem')
{
  ok('global com países é inválido', validarSelecao({ global: true, paisIds: [1] }).length === 1)
  ok('normalizar descarta ids quando é global', normalizarSelecao({ global: true, paisIds: [1, 2] }).paisIds.length === 0)
  ok('sem aplicação é válido por padrão', validarSelecao({ global: false, paisIds: [] }).length === 0)
  ok('sem aplicação é erro quando o tipo exige território', validarSelecao({ global: false, paisIds: [] }, { permiteSemAplicacao: false }).length === 1)
}

// ── 5) Compatibilidade com o campo legado ──────────────────────────────────
secao('5) Registros atuais: compatibilidade sem perda')
{
  ok('"all" vira global', selecaoDoLegado('all', PAISES).global)
  ok('vazio vira global', selecaoDoLegado(null, PAISES).global)
  ok('"italiano" (tela antiga) resolve para Itália', selecaoDoLegado('italiano', PAISES).paisIds.join(',') === '1')
  ok('"italia" (script de carga) resolve para Itália', selecaoDoLegado('italia', PAISES).paisIds.join(',') === '1')
  ok('"alemao" resolve para Alemanha', selecaoDoLegado('alemao', PAISES).paisIds.join(',') === '4')
  ok('"alemã" (acento) resolve para Alemanha', selecaoDoLegado('alemã', PAISES).paisIds.join(',') === '4')
  ok('valor desconhecido vira global (superset seguro, nunca esconde)', selecaoDoLegado('atlantida', PAISES).global)
}

// ── 6) Modelagem: relacional, não textual ──────────────────────────────────
secao('6) Modelagem no banco')
{
  const schema = src('prisma/schema.prisma')
  ok('tabela de vínculo N:N existe', schema.includes('model ServicoProdutoPais'))
  ok('vínculo aponta para o cadastro oficial (CatalogoPais)', /model ServicoProdutoPais[\s\S]*?pais\s+CatalogoPais/.test(schema))
  ok('par serviço×país é único', /model ServicoProdutoPais[\s\S]*?@@unique\(\[servicoId, paisId\]\)/.test(schema))
  ok('indicador explícito de aplicação global', /model ServicoProduto\b[\s\S]*?aplicacaoGlobal\s+Boolean\s+@default\(true\)/.test(schema))
  // O legado não é "congelado": ele SAI. A migration converte e derruba a coluna.
  const blocoServico = schema.slice(schema.indexOf('model ServicoProduto {'), schema.indexOf('\n}', schema.indexOf('model ServicoProduto {')))
  ok('campo textual de nacionalidade ELIMINADO do schema', !/\n\s+nationality\s+String/.test(blocoServico))
  ok('campo textual de categoria ELIMINADO do schema', !/\n\s+category\s+String/.test(blocoServico))

  const mig = src('prisma/migrations-arquivo/20260830200000_catalogo_referencias_estruturais/migration.sql')
  ok('nenhuma tabela é derrubada (só as colunas migradas)', !/DROP TABLE/i.test(mig))
  ok('migration é idempotente', mig.includes('IF NOT EXISTS') && mig.includes('ON CONFLICT'))
  ok('migration migra os vínculos existentes', mig.includes('INSERT INTO "ServicoProdutoPais"'))
  ok('migration resolve os apelidos legados', mig.includes("('italiano', 'italia')") && mig.includes("('alemao', 'alemanha')"))
  ok('migration não escreve no campo legado', !/UPDATE\s+"ServicoProduto"[\s\S]{0,200}"nationality"\s*=/.test(mig))
  ok('migration DERRUBA a coluna legada depois de converter', /DROP COLUMN IF EXISTS "nationality"/.test(mig))
  ok('conversão acontece ANTES do drop', mig.indexOf('INSERT INTO "ServicoProdutoPais"') < mig.indexOf('DROP COLUMN'))
  ok('global não vira vínculo por país na migração', !/INSERT INTO "ServicoProdutoPais"[\s\S]{0,600}CROSS JOIN/.test(mig))
}

// ── 7) API: valida contra o cadastro e não grava texto ─────────────────────
secao('7) API')
{
  const svcTerr = src('src/services/aplicacao-territorial-servico.ts')
  ok('confere país inexistente', svcTerr.includes('País inexistente no cadastro'))
  ok('recusa país inativo', svcTerr.includes('País inativo não pode ser selecionado'))
  ok('global nunca materializa vínculo', svcTerr.includes('const alvo = selecao.global ? [] : selecao.paisIds'))
  ok('gravação é idempotente (estado final)', svcTerr.includes('skipDuplicates: true'))

  const post = src('src/app/api/gerenciamento/produtos-servicos/route.ts')
  const put = src('src/app/api/gerenciamento/produtos-servicos/[id]/route.ts')
  ok('POST resolve e grava a aplicação territorial', post.includes('resolverAplicacaoTerritorial') && post.includes('gravarAplicacaoTerritorial'))
  ok('PUT resolve e grava a aplicação territorial', put.includes('resolverAplicacaoTerritorial') && put.includes('gravarAplicacaoTerritorial'))
  ok('PUT parcial preserva a seleção existente', put.includes('selecaoDoRegistro(atual)'))
  ok('GET devolve os vínculos reais', post.includes('paises: { select: { paisId: true }, orderBy: { criadoEm: \'asc\' } }'))
  ok('GET devolve o cadastro oficial de países', post.includes('paisesCatalogo'))
  ok('erro de país vira 400 (não 500)', post.includes('{ status: 400 }') && put.includes('{ status: 400 }'))
}

// ── 8) Formulário: multisseleção real ──────────────────────────────────────
secao('8) Formulário do Serviço')
{
  const tab = src('src/components/gerenciamentoComponents/ProdutosServicosTab.tsx')
  const ui = src('src/components/gerenciamentoComponents/pagamentoUI.tsx')

  ok('campo tem o rótulo pedido', tab.includes('Países/Regiões aplicáveis'))
  ok('não é mais select de escolha única', !tab.includes('<select value={nationality}'))
  ok('a lista fixa de nacionalidades foi eliminada', !tab.includes("['italiano', 'Italiana']"))
  ok('usa o MultiSelect OFICIAL (sem componente paralelo)', tab.includes('<MultiSelect') && tab.includes("from './pagamentoUI'"))
  ok('opções vêm do cadastro oficial carregado da API', tab.includes('paisesCatalogo.map'))
  ok('busca por nome habilitada', tab.includes('busca') && tab.includes('Buscar país'))
  ok('opção especial "Todas" no seletor', tab.includes('label: ROTULO_TODAS'))
  ok('regra do "Todas" vem da fonte única (a tela não recopia)', tab.includes('alternarTodas(t)') && tab.includes('definirPaises(t, ids)'))
  ok('edição preserva a seleção', tab.includes('setTerritorio(l.territorio ?? marcarTodas())'))
  ok('envia ids + indicador, nunca texto', tab.includes('aplicacaoGlobal: territorio.global') && tab.includes('paises: territorio.paisIds'))

  ok('MultiSelect aceita opção especial', ui.includes('especial?: OpcaoEspecial'))
  // A opção especial é desenhada com o MESMO quadradinho de checkbox das demais
  // opções (mesma marca OURO + ícone Check), fixada no topo do menu aberto.
  const blocoEspecial = ui.slice(ui.indexOf('{especial && ('), ui.indexOf('<ul ref={listaRef}'))
  ok('opção especial usa checkbox na lista aberta', blocoEspecial.includes('Check className') && blocoEspecial.includes('rounded border'))
  ok('opção especial fica fixada no topo (não some com a busca)', blocoEspecial.includes('shrink-0'))
  ok('seleções aparecem como chips', ui.includes('flex flex-wrap gap-1.5'))
  ok('cada chip tem remoção individual', ui.includes('aria-label={`Remover ${o.label}`}'))
  ok('o chip da opção especial também é removível', ui.includes('aria-label={`Remover ${especial.label}`}'))
  ok('individuais ficam apagadas sob a opção especial', ui.includes("especial?.ativa ? 'opacity-45' : ''"))
}

// ── 9) Catálogo: certidão não pode parecer serviço ─────────────────────────
secao('9) Apresentação do Catálogo: famílias separadas')
{
  const conta = (o: Partial<Record<string, number>>) =>
    ({ tiposDocumento: 0, produtos: 0, servicos: 0, precos: 0, ...o })
  const item = (o: Partial<ItemMestreBruto> & { id: number; name: string; natureza: string }): ItemMestreBruto =>
    ({ code: `T${o.id}`, ativo: true, ...o })
  const svc = (o: Partial<ServicoBruto> & { id: number; name: string }): ServicoBruto => ({ ativo: true, ...o })

  ok('pacote é reconhecido pela UNIDADE, não pelo nome', ehPacote('PACOTE') && !ehPacote('documento'))
  ok('serviço é família de venda', grupoDoItem({ natureza: 'SERVICO', unidade: null }) === 'servico_pacote')
  ok('item com unidade pacote é família de venda', grupoDoItem({ natureza: 'OUTRO', unidade: 'PACOTE' }) === 'servico_pacote')
  ok('documento é item relacionado', grupoDoItem({ natureza: 'DOCUMENTO', unidade: 'DOCUMENTO' }) === 'documento_relacionado')
  ok('taxa é item relacionado', grupoDoItem({ natureza: 'TAXA', unidade: null }) === 'documento_relacionado')

  const linhas = unificarCatalogo({
    itens: [
      // certidão COM preço: era o caso que aparecia como "comercializável"
      item({ id: 1, name: 'Certidão de Nascimento', natureza: 'DOCUMENTO', _count: conta({ precos: 1, tiposDocumento: 1 }) }),
      // certidão SEM vínculo com o Documento Mestre: cadastro documental solto
      item({ id: 2, name: 'Certidão avulsa', natureza: 'DOCUMENTO', _count: conta({ produtos: 1 }) }),
      item({ id: 3, name: 'Taxa consular', natureza: 'TAXA', _count: conta({ precos: 1 }) }),
      item({ id: 4, name: 'Pacote Cidadania', natureza: 'OUTRO', unidade: 'PACOTE', _count: conta({ precos: 1 }) }),
    ],
    servicos: [svc({ id: 9, name: 'Apostilamento', itemCatalogo: { id: 50, natureza: 'SERVICO', _count: conta({ servicos: 1 }) } })],
  })

  const comercial = filtrarCatalogo(linhas, { escopo: 'comercial' }).map((l) => l.nome).sort()
  ok('aba Comercializáveis traz só serviço e pacote', comercial.join(',') === 'Apostilamento,Pacote Cidadania')
  ok('certidão precificada NÃO aparece como comercializável', !comercial.includes('Certidão de Nascimento'))
  ok('taxa não aparece como comercializável', !comercial.includes('Taxa consular'))

  const relacionados = filtrarCatalogo(linhas, { escopo: 'relacionados' }).map((l) => l.nome).sort()
  ok('itens cobrados relacionados reúnem documentos e taxas', relacionados.join(',') === 'Certidão avulsa,Certidão de Nascimento,Taxa consular')

  const c = contarPorEscopo(linhas)
  ok('a contagem continua fechando', c.comercial + c.relacionados === c.todos && c.todos === 5)
  ok('aba "Todos" preservada, sem perder linha', filtrarCatalogo(linhas, { escopo: 'todos' }).length === 5)

  const secoes = agruparParaExibicao(filtrarCatalogo(linhas, { escopo: 'todos' }))
  ok('aba "Todos" sai em DUAS seções', secoes.length === 2)
  ok('primeira seção é Serviços e Pacotes', secoes[0].titulo === 'Serviços e Pacotes')
  ok('segunda seção é Documentos e Itens Relacionados', secoes[1].titulo === 'Documentos e Itens Relacionados')
  ok('nenhum documento na seção de venda', secoes[0].linhas.every((l) => l.natureza !== 'DOCUMENTO'))
  ok('títulos vêm de constante única', GRUPO_TITULO.servico_pacote === 'Serviços e Pacotes')

  // Documento Mestre — o catálogo é REFERÊNCIA, nunca cadastro documental.
  const porNome = (n: string) => linhas.find((l) => l.nome === n)!
  ok('certidão vinculada ao Documento Mestre é reconhecida', porNome('Certidão de Nascimento').documentoMestreVinculado === true)
  ok('certidão sem vínculo é DENUNCIADA', porNome('Certidão avulsa').documentoMestreVinculado === false)
  ok('serviço não recebe julgamento documental', porNome('Apostilamento').documentoMestreVinculado === null)
  ok('taxa não recebe julgamento documental', porNome('Taxa consular').documentoMestreVinculado === null)

  // Rótulo da aba renomeado.
  ok('aba renomeada para "Itens cobrados relacionados"', ESCOPOS.some((e) => e.label === 'Itens cobrados relacionados'))
  ok('não existe mais aba "Itens técnicos"', !ESCOPOS.some((e) => e.label === 'Itens técnicos'))
  ok('aba "Todos" mantida', ESCOPOS.some((e) => e.valor === 'todos'))

  // Filtro territorial na listagem.
  const comTerritorio = unificarCatalogo({
    servicos: [
      svc({ id: 1, name: 'Só Itália', aplicacaoGlobal: false, paises: [{ paisId: 1 }], itemCatalogo: { id: 1, natureza: 'SERVICO', _count: conta({ servicos: 1 }) } }),
      svc({ id: 2, name: 'Global', aplicacaoGlobal: true, itemCatalogo: { id: 2, natureza: 'SERVICO', _count: conta({ servicos: 1 }) } }),
      svc({ id: 3, name: 'Sem território', aplicacaoGlobal: false, paises: [], itemCatalogo: { id: 3, natureza: 'SERVICO', _count: conta({ servicos: 1 }) } }),
    ],
  })
  const porPais = (p: number | 'global') => filtrarCatalogo(comTerritorio, { escopo: 'todos', pais: p }).map((l) => l.nome).sort()
  ok('filtrar por Itália traz o específico E o global', porPais(1).join(',') === 'Global,Só Itália')
  ok('filtrar por Alemanha traz só o global', porPais(4).join(',') === 'Global')
  ok('filtrar "só global" isola a aplicação global', porPais('global').join(',') === 'Global')
  ok('item sem território não casa com filtro territorial', !porPais(1).includes('Sem território'))
  ok('payload sem o campo lê como global (compatibilidade)', filtrarCatalogo(
    unificarCatalogo({ servicos: [svc({ id: 7, name: 'Antigo', itemCatalogo: { id: 7, natureza: 'SERVICO', _count: conta({ servicos: 1 }) } })] }),
    { escopo: 'todos', pais: 4 },
  ).length === 1)

  ok('rótulo territorial do item técnico é vazio (não mente)', rotuloTerritorio(porNome('Taxa consular'), PAISES) === null)
  ok('rótulo territorial do serviço global', rotuloTerritorio(comTerritorio.find((l) => l.nome === 'Global')!, PAISES) === ROTULO_GLOBAL)
}

// ── 10) A tela não vira segunda fonte documental ───────────────────────────
secao('10) Fonte oficial do documento preservada')
{
  const tab = src('src/components/gerenciamentoComponents/ProdutosServicosTab.tsx')
  ok('a tela aponta para a fonte oficial do documento', tab.includes('Documentos e Protocolos'))
  ok('documento sem vínculo é sinalizado ao operador', tab.includes('Sem vínculo com Documentos e Protocolos'))
  ok('coluna Tipo continua visível', tab.includes('>Tipo</th>'))
  ok('coluna Aplicação foi adicionada', tab.includes('>Aplicação</th>'))
  ok('seções de família aparecem na tabela', tab.includes('agruparParaExibicao'))
}

console.log(`\n${'='.repeat(64)}`)
console.log(`Aplicação territorial + Catálogo: ${passou} passaram, ${falhou} falharam`)
if (falhou > 0) {
  console.log('\nFalhas:')
  for (const f of falhas) console.log(`  · ${f}`)
  process.exit(1)
}
console.log('Campo de países multisseleção e separação de famílias validados ✅')
