/**
 * GUARDA — CÓDIGO CANÔNICO DO CATÁLOGO DE SERVIÇOS (SRV-n).
 * Rodar: npm run test:codigo-servicos
 *
 * A REGRA
 * -------
 * Todo serviço do Catálogo tem código SRV-{sequencial}: obrigatório, único,
 * imutável, gerado no backend, atribuído na criação, preservado na edição.
 * O portador é UM só — `ServicoProduto.publicCode`. Item do mestre não carrega
 * código, e é por isso que serviço não pode nascer como item do mestre.
 *
 * A SEPARAÇÃO
 * -----------
 * Catálogo de Serviços mostra o código (é o cadastro de origem).
 * Configurações Financeiras mostra só o nome. As duas regras não se misturam.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { unificarCatalogo, filtrarCatalogo, type ItemMestreBruto, type ServicoBruto } from '../lib/gerenciamento/catalogo-servicos'
import { CODE_REGISTRY } from '../lib/codigos/entity-registry'
import { CODE_PREFIX, formatarCodigo, escopoDe, padraoLikeDe } from '../lib/codigos/code-patterns'
import { codeServicoDeMestre } from '../src/services/catalogo-sync'
import { codeServicoMestre } from '../src/services/catalogo-helpers'

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..')
const src = (p: string) => readFileSync(join(RAIZ, p), 'utf8')

let passou = 0, falhou = 0
const falhas: string[] = []
const ok = (nome: string, cond: boolean) => {
  if (cond) { passou++; console.log(`  ✅ ${nome}`) }
  else { falhou++; falhas.push(nome); console.log(`  ❌ ${nome}`) }
}
const secao = (t: string) => console.log(`\n${t}`)

console.log('Código canônico do Catálogo de Serviços — SRV-n\n')

// ── 1) O portador do código é ÚNICO e canônico ──────────────────────────────
secao('1) Entidade canônica e campo oficial')

ok('ServicoProduto é a entidade registrada para o código SRV', CODE_REGISTRY.ServicoProduto?.entidade === 'SERVICE')
ok('o campo oficial é publicCode', CODE_REGISTRY.ServicoProduto?.campo === 'publicCode')
ok('o prefixo do serviço é SRV', CODE_PREFIX.SERVICE === 'SRV')
ok('o formato escrito é SRV-{n}', formatarCodigo('SERVICE', 7) === 'SRV-7')
ok('a sequência tem escopo próprio "SRV"', escopoDe('SERVICE') === 'SRV')
ok('o padrão de reconciliação casa SRV-%', padraoLikeDe('SERVICE') === 'SRV-%')

// ItemCatalogo NÃO pode ser um segundo portador: dois portadores do mesmo
// identificador seriam duas fontes da verdade.
ok('ItemCatalogo NÃO está no registro de códigos (não é portador de SRV-n)', !CODE_REGISTRY.ItemCatalogo)
ok('ItemCatalogo não tem coluna publicCode no schema', (() => {
  const modelo = src('prisma/schema.prisma').split(/^model /m).find((m) => m.startsWith('ItemCatalogo '))
  return !!modelo && !/\bpublicCode\b/.test(modelo)
})())
ok('ServicoProduto.publicCode é UNIQUE no schema', (() => {
  const modelo = src('prisma/schema.prisma').split(/^model /m).find((m) => m.startsWith('ServicoProduto '))
  return !!modelo && /publicCode\s+String\?\s+@unique/.test(modelo)
})())

// ── 2) Geração: backend, atômica, imutável ──────────────────────────────────
secao('2) Geração no backend — atômica e imutável')

const gerador = src('lib/codigos/code-generator.ts')
ok('a sequência avança por INSERT ... ON CONFLICT DO UPDATE (atômico)', /ON CONFLICT \("scope"\)[\s\S]*DO UPDATE SET "ultimo" = "CodeSequence"\."ultimo" \+ 1/.test(gerador))
ok('não usa COUNT(*) + 1', !/count\(\*\)\s*\+\s*1/i.test(gerador))
ok('não usa MAX(id) para numerar (só para RESSINCRONIZAR a sequência)', !/MAX\("?id"?\)/i.test(gerador))
ok('não usa timestamp/random/uuid como número', !/Date\.now\(\)|Math\.random\(\)|randomUUID/.test(gerador))

const extensao = src('lib/prisma.ts')
ok('o create ignora publicCode enviado pelo cliente', /delete data\[cfg\.campo\]/.test(extensao))
ok('o update REMOVE publicCode do data (código imutável)', /async update\(\{ model, args, query \}\)[\s\S]{0,220}delete data\[cfg\.campo\]/.test(extensao))
ok('o updateMany também remove publicCode', /async updateMany\(\{ model, args, query \}\)[\s\S]{0,220}delete data\[cfg\.campo\]/.test(extensao))
ok('colisão de código ressincroniza a sequência e tenta de novo (sem duplicar registro)', /ehColisaoDeCodigo[\s\S]{0,400}sincronizarSequenciaComTabela/.test(extensao))

// ── 3) O frontend não fabrica nem edita código ──────────────────────────────
secao('3) O frontend nunca gera o código')

const tab = src('src/components/gerenciamentoComponents/ProdutosServicosTab.tsx')
ok('o formulário não envia publicCode/code na criação', !/publicCode:\s|code:\s*[a-zA-Z]/.test(tab.split('async function salvar()')[1]?.split('async function excluir')[0] ?? ''))
ok('o campo de código na edição é somente leitura (CodigoPublicoField)', /<CodigoPublicoField/.test(tab))

// ── 4) Serviço não nasce como item do mestre (a causa raiz) ─────────────────
secao('4) A porta que criava serviço sem código está fechada')

const rotaMestre = src('src/app/api/gerenciamento/catalogo-mestre/route.ts')
ok('POST do mestre RECUSA natureza SERVICO', /b\.natureza === NaturezaItem\.SERVICO[\s\S]{0,400}status: 400/.test(rotaMestre))
ok('a recusa aponta a rota correta do Catálogo de Serviços', /produtos-servicos/.test(rotaMestre))

const rotaMestreId = src('src/app/api/gerenciamento/catalogo-mestre/[id]/route.ts')
ok('PUT do mestre recusa CONVERTER item em SERVICO sem serviço vinculado', /b\.natureza === NaturezaItem\.SERVICO[\s\S]{0,500}temServico === 0[\s\S]{0,300}status: 400/.test(rotaMestreId))

const rotaServicos = src('src/app/api/gerenciamento/produtos-servicos/route.ts')
ok('a criação de serviço roda em transação', /prisma\.\$transaction/.test(rotaServicos))
ok('a criação de serviço grava ServicoProduto (portador do código)', /tx\.servicoProduto\.create/.test(rotaServicos))
// Menção em comentário é permitida; o que não pode existir é ATRIBUIÇÃO.
ok('a criação não monta código público manualmente', !/publicCode\s*[:=]/.test(rotaServicos))
ok('a listagem devolve o serviço com publicCode (select não recorta o campo)', !/select:\s*\{[^}]*\bname\b[^}]*\}/.test(rotaServicos.split('servicoProduto.findMany')[1]?.slice(0, 300) ?? ''))

// ── 5) Promoção item → serviço: idempotente e sem código inventado ──────────
secao('5) garantirServicoDoItem — promoção idempotente')

const sync = src('src/services/catalogo-sync.ts')
ok('a promoção exige natureza SERVICO', /natureza !== NaturezaItem\.SERVICO[\s\S]{0,200}throw/.test(sync))
ok('item que já tem serviço devolve o existente (idempotente, sem consumir número)', /if \(existente\) return \{[\s\S]{0,120}criado: false/.test(sync))
ok('serviço criado sem publicCode DERRUBA a transação', /if \(!s\.publicCode\)[\s\S]{0,200}throw new Error/.test(sync))
ok('a promoção não monta o código (quem numera é o gerador)', !/SRV-\$\{|`SRV-/.test(sync))

// a chave técnica é derivada do mestre, ida e volta
ok('codeServicoMestre e codeServicoDeMestre são inversos', codeServicoDeMestre(codeServicoMestre('EMISSAO_CERTIDAO')) === 'EMISSAO_CERTIDAO')
ok('code sem prefixo SRV_ é preservado', codeServicoDeMestre('EMISSAO_CERTIDAO') === 'EMISSAO_CERTIDAO')
ok('a derivação não inventa nome nem usa o publicCode', codeServicoDeMestre('SRV_TRADUCAO_JURAMENTADA') === 'TRADUCAO_JURAMENTADA')

// ── 6) Backfill: só os ausentes, nunca renumerando ──────────────────────────
secao('6) Backfill idempotente')

const backfill = src('scripts/backfill-codigo-servicos-catalogo.ts')
ok('seleciona SÓ itens SERVICO sem ServicoProduto', /natureza: NaturezaItem\.SERVICO, servicos: \{ none: \{\} \}/.test(backfill))
ok('não escreve sem --execute', /if \(!EXECUTAR\)[\s\S]{0,200}return/.test(backfill))
ok('usa o client ESTENDIDO (a extensão é quem gera o código)', /from '@\/lib\/prisma'/.test(backfill) && !/^\s*(const|let)\s+\w+\s*=\s*new PrismaClient\(/m.test(backfill))
ok('delega a promoção ao serviço canônico', /garantirServicoDoItem/.test(backfill))
ok('não faz UPDATE de publicCode em serviço existente (não renumera)', !/publicCode:\s*[`'"]/.test(backfill))
ok('confere no BANCO que ninguém ficou sem código', /publicCode: null[\s\S]{0,400}throw new Error/.test(backfill))

// ── 7) A tela: código na coluna Código, nome à parte, chave fora ────────────
secao('7) Exibição no Catálogo de Serviços')

const servico = (over: Partial<ServicoBruto> = {}): ServicoBruto => ({
  id: 1, publicCode: 'SRV-5', name: 'Apostilamento de Certidão', descricao: null,
  itemCatalogoId: 90, aplicacaoGlobal: true, ativo: true,
  itemCatalogo: { id: 90, natureza: 'SERVICO', unidade: 'UNIDADE', categoriaId: null, _count: { tiposDocumento: 0, produtos: 1, servicos: 1, precos: 0 } },
  ...over,
} as ServicoBruto)

const linhas = unificarCatalogo({ servicos: [servico()], itens: [] })
ok('a linha do serviço leva o publicCode para a coluna Código', linhas[0]?.codigo === 'SRV-5')
ok('nome e código são campos SEPARADOS (nome não contém o código)', linhas[0]?.nome === 'Apostilamento de Certidão')
ok('a chave estrutural não vai para a listagem', !JSON.stringify(linhas[0]).includes('SRV_APOSTILAMENTO'))

// serviço válido nunca cai no "—": só item técnico (que não é serviço) tem codigo null
const itemTecnico: ItemMestreBruto = {
  id: 43, code: 'DOC_RG', name: 'RG', natureza: 'DOCUMENTO', ativo: true,
  _count: { tiposDocumento: 1, produtos: 0, servicos: 0, precos: 0 },
} as ItemMestreBruto
const mistas = unificarCatalogo({ servicos: [servico()], itens: [itemTecnico] })
ok('nenhuma linha de ORIGEM serviço fica sem código', mistas.filter((l) => l.origem === 'servico').every((l) => !!l.codigo))
ok('item técnico (documento) segue sem SRV-n — ele não é serviço', mistas.find((l) => l.origem === 'item')?.codigo === null)

// depois do backfill, item de natureza SERVICO não deve mais existir solto
const itemServicoSolto: ItemMestreBruto = {
  id: 37, code: 'SRV_EMISSAO_CERTIDAO', name: 'Emissão de Certidão', natureza: 'SERVICO', ativo: true,
  _count: { tiposDocumento: 0, produtos: 1, servicos: 0, precos: 0 },
} as ItemMestreBruto
const comSolto = unificarCatalogo({ servicos: [], itens: [itemServicoSolto] })
ok('item SERVICO solto é justamente o que aparece sem código (estado que o backfill elimina)', comSolto[0]?.codigo === null && comSolto[0]?.origem === 'item')

// busca por código
const achados = filtrarCatalogo(unificarCatalogo({ servicos: [servico()], itens: [] }), { escopo: 'todos', busca: 'srv-5' })
ok('a busca encontra o serviço pelo código', achados.length === 1)
ok('a busca por código inexistente não devolve nada', filtrarCatalogo(linhas, { escopo: 'todos', busca: 'SRV-999' }).length === 0)

// ── 8) Configurações Financeiras continua sem código ────────────────────────
secao('8) Separação — Configurações Financeiras mostra só o nome')

const aplic = src('src/components/gerenciamentoComponents/AplicabilidadeEconomicaTab.tsx')
ok('a tela de Configurações Financeiras não exibe publicCode', !/publicCode/.test(aplic))
ok('a tela de Configurações Financeiras não exibe SRV-', !/SRV-/.test(aplic))

// ── Resultado ───────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(60)}`)
console.log(`Total: ${passou + falhou} | ✅ ${passou} | ❌ ${falhou}`)
if (falhou > 0) {
  console.log('\nFalhas:')
  for (const f of falhas) console.log(`  · ${f}`)
  process.exit(1)
}
console.log('Todo serviço do Catálogo tem portador único de código, gerado no backend.\n')
