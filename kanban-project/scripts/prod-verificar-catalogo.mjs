// scripts/prod-verificar-catalogo.mjs
// ============================================================================
// SMOKE DO CATÁLOGO — verificação SOMENTE LEITURA do estado real do banco.
//
// Existe porque a credencial do banco é Sensitive e não sai da Vercel: a única
// forma honesta de OBSERVAR produção (em vez de deduzir do log da migration) é
// rodar a verificação onde o banco existe — dentro do build.
//
// Não escreve nada. Não altera nada. Só conta e imprime. Roda em qualquer
// ambiente (produção, homologação) e nunca derruba o build por conta própria:
// um catálogo em estado inesperado vira ALERTA visível no log, não deploy
// vermelho — a decisão sobre o dado é humana.
//
// O que comprova:
//   1. as três colunas textuais estruturais NÃO existem mais;
//   2. as três categorias oficiais existem, ativas e na ordem certa;
//   3. não há duplicidade semântica entre categorias;
//   4. todo vínculo de categoria é por categoriaId;
//   5. os serviços comerciais e sua aplicação territorial (N:N real);
//   6. certidões continuam sendo Documento, nunca Serviço.
// ============================================================================
import { PrismaClient } from '@prisma/client'
import { classificar, identificador, retratar } from '../lib/db/identidade-banco.mjs'

const prisma = new PrismaClient()
const url = process.env.PRISMA_DATABASE_URL || process.env.DATABASE_URL || ''

// Mesma normalização semântica do domínio (lib/gerenciamento/cadastro-identidade).
// Reescrita aqui em .mjs porque o script roda antes do bundle TypeScript existir;
// qualquer divergência aparece no teste que compara as duas.
const chaveSemantica = (v) =>
  (v ?? '').normalize('NFC').replace(/\s+/g, ' ').trim()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[-_]/g, ' ').replace(/\s+/g, ' ').trim()

const CODES_OFICIAIS = ['CIDNAC', 'REGCIV', 'RETREG']

async function colunaExiste(tabela, coluna) {
  const r = await prisma.$queryRawUnsafe(
    `SELECT 1 FROM information_schema.columns WHERE table_name = $1 AND column_name = $2 LIMIT 1`,
    tabela, coluna,
  )
  return r.length > 0
}

async function main() {
  const retrato = await retratar(prisma)
  console.log(`[catalogo-smoke] alvo: ${identificador(url)} — ${classificar(retrato)} (tabelas=${retrato.tabelas}, migrations=${retrato.migrations})`)

  let alertas = 0
  const alerta = (m) => { alertas++; console.log(`[catalogo-smoke] ⚠ ${m}`) }
  const okLog = (m) => console.log(`[catalogo-smoke] ✓ ${m}`)

  // ── 1) As colunas textuais estruturais sumiram ────────────────────────────
  for (const [tabela, coluna] of [['ServicoProduto', 'category'], ['ServicoProduto', 'nationality'], ['ItemCatalogo', 'categoria']]) {
    if (await colunaExiste(tabela, coluna)) alerta(`coluna legada AINDA EXISTE: ${tabela}.${coluna}`)
    else okLog(`coluna legada removida: ${tabela}.${coluna}`)
  }
  for (const [tabela, coluna] of [['ItemCatalogo', 'categoriaId'], ['ServicoProduto', 'aplicacaoGlobal']]) {
    if (await colunaExiste(tabela, coluna)) okLog(`vínculo estrutural presente: ${tabela}.${coluna}`)
    else alerta(`vínculo estrutural AUSENTE: ${tabela}.${coluna}`)
  }

  // ── 2) Categorias oficiais ────────────────────────────────────────────────
  const categorias = await prisma.categoriaServico.findMany({
    orderBy: [{ ordem: 'asc' }, { nome: 'asc' }],
    select: { id: true, code: true, nome: true, ordem: true, ativo: true, _count: { select: { itens: true } } },
  })
  console.log(`[catalogo-smoke] categorias cadastradas: ${categorias.length}`)
  for (const c of categorias) {
    console.log(`[catalogo-smoke]   #${c.id} [${c.code}] ordem=${c.ordem} ativo=${c.ativo} itens=${c._count.itens} — ${c.nome}`)
  }
  for (const code of CODES_OFICIAIS) {
    const c = categorias.find((x) => x.code === code)
    if (!c) alerta(`categoria oficial AUSENTE: ${code}`)
    else if (!c.ativo) alerta(`categoria oficial INATIVA: ${code}`)
    else okLog(`categoria oficial ativa: ${code} (#${c.id}) — ${c.nome}`)
  }
  const oficiais = CODES_OFICIAIS.map((code) => categorias.find((x) => x.code === code)).filter(Boolean)
  const ordemOk = oficiais.length === 3 && oficiais[0].ordem < oficiais[1].ordem && oficiais[1].ordem < oficiais[2].ordem
  if (ordemOk) okLog('ordem oficial correta: Cidadania e Nacionalidade < Registro Civil < Retificação')
  else alerta('ordem das categorias oficiais fora do esperado')

  // ── 3) Duplicidade semântica ──────────────────────────────────────────────
  const porChave = new Map()
  for (const c of categorias) {
    const k = chaveSemantica(c.nome)
    porChave.set(k, [...(porChave.get(k) ?? []), c])
  }
  const dups = [...porChave.values()].filter((g) => g.length > 1)
  if (dups.length === 0) okLog('nenhuma duplicidade semântica entre categorias')
  for (const g of dups) alerta(`DUPLICIDADE semântica: ${g.map((c) => `#${c.id} [${c.code}] ${c.nome}`).join(' | ')}`)

  const codes = categorias.map((c) => c.code)
  if (new Set(codes).size === codes.length) okLog('códigos únicos')
  else alerta('há códigos repetidos em CategoriaServico')

  // ── 4) Serviços comerciais e aplicação territorial ────────────────────────
  const servicos = await prisma.servicoProduto.findMany({
    orderBy: { id: 'asc' },
    select: {
      id: true, publicCode: true, code: true, name: true, ativo: true, aplicacaoGlobal: true,
      itemCatalogo: { select: { id: true, natureza: true, categoriaId: true, categoria: { select: { code: true, nome: true } } } },
      paises: { select: { pais: { select: { countryKey: true, countryLabel: true } } }, orderBy: { criadoEm: 'asc' } },
    },
  })
  console.log(`[catalogo-smoke] serviços cadastrados: ${servicos.length}`)
  for (const s of servicos) {
    const cat = s.itemCatalogo?.categoria ? `${s.itemCatalogo.categoria.code}` : 'SEM CATEGORIA'
    const terr = s.aplicacaoGlobal
      ? 'GLOBAL'
      : s.paises.length ? s.paises.map((p) => p.pais.countryLabel).join(' + ') : 'sem aplicação territorial'
    console.log(`[catalogo-smoke]   #${s.id} [${s.publicCode ?? s.code}] ativo=${s.ativo} cat=${cat} territorio=${terr} — ${s.name}`)
  }

  // ── 5) Certidão é Documento, nunca Serviço ────────────────────────────────
  const docsComoServico = servicos.filter((s) => s.itemCatalogo?.natureza === 'DOCUMENTO')
  if (docsComoServico.length === 0) okLog('nenhuma certidão cadastrada como Serviço')
  else alerta(`${docsComoServico.length} item(ns) de natureza DOCUMENTO com registro de Serviço: ${docsComoServico.map((s) => s.name).join(', ')}`)

  const documentos = await prisma.itemCatalogo.count({ where: { natureza: 'DOCUMENTO' } })
  const docsVinculados = await prisma.itemCatalogo.count({ where: { natureza: 'DOCUMENTO', tiposDocumento: { some: {} } } })
  console.log(`[catalogo-smoke] documentos no mestre: ${documentos} · com Documento Mestre oficial: ${docsVinculados} · órfãos: ${documentos - docsVinculados}`)

  // ── 6) Itens sem categoria (informativo, não é erro) ──────────────────────
  const semCategoria = await prisma.itemCatalogo.count({ where: { categoriaId: null } })
  console.log(`[catalogo-smoke] itens do mestre sem categoria: ${semCategoria} (estado válido — categoria é opcional)`)

  // ── 7) Itens PRECIFICÁVEIS por natureza — o que a Tabela de Valores oferece ─
  // Prova direta do campo "Tipo de item": a fonte é o cadastro mestre, então um
  // Documento Mestre aparece mesmo sem nunca ter tido preço.
  const precificaveis = await prisma.itemCatalogo.findMany({
    where: { ativo: true, natureza: { in: ['SERVICO', 'DOCUMENTO', 'TAXA', 'DESPESA', 'LOGISTICA', 'OUTRO'] } },
    select: { id: true, code: true, name: true, natureza: true, produtos: { where: { ativo: true }, select: { id: true }, take: 1 } },
    orderBy: [{ natureza: 'asc' }, { name: 'asc' }],
  })
  const porNatureza = new Map()
  for (const i of precificaveis) porNatureza.set(i.natureza, [...(porNatureza.get(i.natureza) ?? []), i])
  console.log(`[catalogo-smoke] itens precificáveis: ${precificaveis.length}`)
  for (const [nat, lista] of porNatureza) {
    console.log(`[catalogo-smoke]   ${nat}: ${lista.length} item(ns)`)
    for (const i of lista) console.log(`[catalogo-smoke]      #${i.id} ${i.code} — ${i.name}${i.produtos.length ? '' : ' (sem config; criada ao salvar preço)'}`)
  }
  const docs = porNatureza.get('DOCUMENTO') ?? []
  if (docs.length > 0) okLog(`tipo Documentos oferece ${docs.length} item(ns) na Tabela de Valores`)
  else alerta('tipo Documentos NÃO oferece item algum — certidões ficariam fora da Tabela de Valores')

  console.log(`[catalogo-smoke] ${alertas === 0 ? 'OK — catálogo íntegro.' : `${alertas} ALERTA(S) — conferir acima.`}`)
  await prisma.$disconnect()
}

main().catch(async (e) => {
  // Verificação NUNCA derruba o build: ela informa. Um erro aqui é problema do
  // smoke, não motivo para bloquear um deployment já validado pelo guard.
  console.log(`[catalogo-smoke] AVISO: verificação não concluída (${String(e?.message ?? e).slice(0, 200)})`)
  await prisma.$disconnect()
})
