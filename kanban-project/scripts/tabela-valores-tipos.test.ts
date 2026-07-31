/**
 * GUARDA — Tabela de Valores: tipo de item vem do cadastro mestre.
 * Rodar: npm run test:tabela-valores-tipos
 *
 * O defeito que este teste trava: as opções de tipo eram derivadas das
 * Configurações Financeiras JÁ existentes, então a tela só oferecia o que já
 * tinha preço — e um Documento Mestre nunca precificado ficava invisível.
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

console.log('Tabela de Valores — tipo de item pela fonte oficial\n')

const api = src('src/app/api/gerenciamento/tabela-valores/route.ts')
const tela = src('src/components/gerenciamentoComponents/TabelaValoresTab.tsx')
const helper = src('src/services/config-financeira-auto.ts')

secao('1) A fonte é o CADASTRO MESTRE, não as configs existentes')
{
  ok('lista itens precificáveis do ItemCatalogo', api.includes('listarItensPrecificaveis') && api.includes('prisma.itemCatalogo.findMany'))
  ok('a antiga listagem por configs não existe mais', !api.includes('async function listarConfigs'))
  ok('naturezas vêm da fonte única do catálogo', api.includes('NATUREZAS_ITEM_OFICIAIS.map'))
  ok('nenhuma lista paralela de tipos no backend', !/const TIPOS\s*=\s*\[/.test(api))
  ok('só item ATIVO é ofertado', /listarItensPrecificaveis[\s\S]{0,400}ativo: true/.test(api))
  ok('item sem config continua ofertável', api.includes('id: cfg?.id ?? null'))
}

secao('2) Precificar documento não o transforma em serviço')
{
  ok('helper de config é genérico (qualquer item)', helper.includes('garantirConfigFinanceiraDeItem'))
  ok('não existe mais helper exclusivo de serviço', !helper.includes('garantirConfigFinanceiraDeServico'))
  ok('vínculo do helper é estrutural', helper.includes('itemCatalogoId: s.itemCatalogoId'))
  ok('POST cria a config do item ao salvar preço', api.includes('garantirConfigFinanceiraDeItem(prisma, { itemCatalogoId: item.id'))
  ok('POST recusa item inexistente', api.includes('Item do catálogo inexistente'))
  ok('POST recusa item inativo', api.includes('Item inativo não pode receber preço'))
  ok('nenhuma conversão de natureza ao precificar', !/natureza:\s*['"]SERVICO['"]/.test(api))
}

secao('3) Vínculo por ID, nunca por texto')
{
  ok('a tela envia o id do item mestre', tela.includes('itemCatalogoId: Number(form.itemCatalogoId)'))
  ok('a opção do select carrega o id do item', tela.includes('value={c.itemCatalogoId}'))
  ok('o tipo não é gravado (é navegação)', tela.includes('categoria: _c,'))
  ok('nenhum nome/código é enviado como vínculo', !/itemNome|categoriaTexto|tipoTexto/.test(tela))
  ok('o preço continua pertencendo à Configuração Financeira', api.includes('configuracaoFinanceiraItemId: configId'))
}

secao('4) Tipos oficiais e UX')
{
  ok('tipos são a natureza oficial do item', tela.includes("SERVICO: 'Serviços', DOCUMENTO: 'Documentos', TAXA: 'Taxas'"))
  ok('Documentos é uma opção do campo', tela.includes("DOCUMENTO: 'Documentos'"))
  ok('rótulo do campo é "Tipo de item"', tela.includes('Tipo de item *'))
  ok('os tipos saem da natureza dos itens carregados', tela.includes('configs.map((c) => c.natureza)'))
  ok('busca no campo Item', tela.includes('Buscar item por nome ou código'))
  ok('estado vazio correto', tela.includes('Nenhum item encontrado para esta busca') && tela.includes('Nenhum item ativo de'))
  ok('exibe código público só para apresentação', tela.includes('${c.codigo}'))
  ok('Salvar desabilitado sem item válido', tela.includes('disabled={salvando || (!form.itemCatalogoId && !form.configuracaoFinanceiraItemId)}'))
  ok('erro mantém o formulário preenchido', tela.includes('setErroModal'))
}

secao('5) Proteções de preço preservadas')
{
  ok('conflito de preço segue detectado', api.includes('detectarConflitoPreco'))
  ok('sobreposição de vigência segue barrada', api.includes('vigencia_sem_sobreposicao'))
  ok('preço idêntico segue barrado (409)', api.includes('config_contexto_ativo'))
}

console.log(`\n${'='.repeat(60)}`)
console.log(`Tabela de Valores: ${passou} passaram, ${falhou} falharam`)
if (falhou > 0) { console.log('\nFalhas:'); for (const f of falhas) console.log(`  · ${f}`); process.exit(1) }
console.log('Tipo de item pela fonte oficial validado ✅')
