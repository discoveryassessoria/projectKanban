// scripts/prod-auditar-referencias-textuais.mjs
// ============================================================================
// AUDITORIA DE DADOS das referências estruturais em texto — SOMENTE LEITURA.
//
// O guard de arquitetura (test:arquitetura-referencias) encontra as dívidas no
// CÓDIGO. Este script responde a outra pergunta, que é a que decide se cada
// migração é possível: QUAIS VALORES existem de fato no banco, e quantos deles
// resolvem contra o cadastro oficial.
//
// Sem esta resposta, todo backfill é chute — e chutar equivalência é exatamente
// o que a Regra Suprema 2 proíbe. Um valor que não resolve não pode virar
// entidade nova (isso seria criar cadastro a partir de texto), nem ser
// descartado. Ele tem de aparecer aqui, por extenso, para decisão.
//
// Não escreve nada. Não altera nada. Nunca derruba o build.
// ============================================================================
import { PrismaClient } from '@prisma/client'
import { identificador, retratar } from '../lib/db/identidade-banco.mjs'

const prisma = new PrismaClient()
const url = process.env.PRISMA_DATABASE_URL || process.env.DATABASE_URL || ''

const norm = (v) =>
  (v ?? '').normalize('NFC').replace(/\s+/g, ' ').trim()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[-_]/g, ' ').replace(/\s+/g, ' ').trim()

/**
 * Cada dívida: tabela, coluna textual, e o cadastro oficial que deveria estar
 * do outro lado da FK. `chaves` são as colunas do cadastro contra as quais o
 * valor é testado (todas normalizadas).
 */
const DIVIDAS = [
  // ── País como texto ──────────────────────────────────────────────────────
  { tabela: 'Processo', coluna: 'pais', destino: 'CatalogoPais', chaves: ['countryKey', 'countryLabel', 'nationalityKey', 'nationalityLabel'] },
  { tabela: 'Status', coluna: 'pais', destino: 'CatalogoPais', chaves: ['countryKey', 'countryLabel'] },
  { tabela: 'Tarefa', coluna: 'pais', destino: 'CatalogoPais', chaves: ['countryKey', 'countryLabel'] },
  { tabela: 'Uniao', coluna: 'pais', destino: 'CatalogoPais', chaves: ['countryKey', 'countryLabel'] },
  { tabela: 'Contratante', coluna: 'pais', destino: 'CatalogoPais', chaves: ['countryKey', 'countryLabel'] },
  { tabela: 'Requerente', coluna: 'pais', destino: 'CatalogoPais', chaves: ['countryKey', 'countryLabel'] },
  { tabela: 'Fornecedor', coluna: 'pais', destino: 'CatalogoPais', chaves: ['countryKey', 'countryLabel'] },
  { tabela: 'Banco', coluna: 'pais', destino: 'CatalogoPais', chaves: ['countryKey', 'countryLabel'] },
  { tabela: 'OrgaoProtocolo', coluna: 'country', destino: 'CatalogoPais', chaves: ['countryKey', 'countryLabel'] },
  { tabela: 'TipoProtocoloCadastro', coluna: 'nacionalidade', destino: 'CatalogoPais', chaves: ['nationalityKey', 'nationalityLabel', 'countryKey'] },

  // ── Nacionalidade de pessoa ──────────────────────────────────────────────
  { tabela: 'Pessoa', coluna: 'nacionalidade', destino: 'CatalogoPais', chaves: ['nationalityKey', 'nationalityLabel', 'countryKey', 'countryLabel'] },
  { tabela: 'Requerente', coluna: 'nacionalidade', destino: 'CatalogoPais', chaves: ['nationalityKey', 'nationalityLabel', 'countryKey'] },
  { tabela: 'Contratante', coluna: 'nacionalidade', destino: 'CatalogoPais', chaves: ['nationalityKey', 'nationalityLabel', 'countryKey'] },
  { tabela: 'ClienteFinal', coluna: 'nacionalidade', destino: 'CatalogoPais', chaves: ['nationalityKey', 'nationalityLabel', 'countryKey'] },

  // ── Cadastros de pagamento ───────────────────────────────────────────────
  { tabela: 'FormaPagamentoCadastro', coluna: 'moeda', destino: 'MoedaCadastro', chaves: ['code', 'name'] },
  { tabela: 'TaxaPagamento', coluna: 'moeda', destino: 'MoedaCadastro', chaves: ['code', 'name'] },
  { tabela: 'CotacaoCambio', coluna: 'modalidade', destino: 'ModalidadePais', chaves: ['modalityKey', 'modalityLabel'] },
  { tabela: 'CondicaoPagamento', coluna: 'perfil', destino: null, chaves: [] },
  { tabela: 'TaxaPagamento', coluna: 'perfil', destino: null, chaves: [] },

  // ── Financeiro / operação ────────────────────────────────────────────────
  { tabela: 'Custo', coluna: 'fornecedor', destino: 'Fornecedor', chaves: ['nome'] },
  { tabela: 'OutroCusto', coluna: 'fornecedor', destino: 'Fornecedor', chaves: ['nome'] },
  { tabela: 'LedgerEntry', coluna: 'contaContabil', destino: 'ContaContabil', chaves: ['codigo', 'nome'] },
  { tabela: 'PhaseWorkflowStepInstance', coluna: 'equipe', destino: 'GrupoUsuario', chaves: ['nome'] },

  // ── Categorias/regiões diversas ──────────────────────────────────────────
  { tabela: 'TipoDocumentoCadastro', coluna: 'category', destino: 'CategoriaDocumental', chaves: ['code', 'nome'] },
  { tabela: 'TabelaValor', coluna: 'regiao', destino: 'CatalogoPais', chaves: ['countryKey', 'countryLabel'] },
  { tabela: 'ModeloDocumento', coluna: 'categoria', destino: 'CategoriaDocumental', chaves: ['code', 'nome'] },
  { tabela: 'FormaPagamentoCadastro', coluna: 'categoria', destino: null, chaves: [] },
  { tabela: 'TaxaPagamento', coluna: 'categoria', destino: null, chaves: [] },
  { tabela: 'AnexoContratante', coluna: 'categoria', destino: null, chaves: [] },
  { tabela: 'AnexoRequerente', coluna: 'categoria', destino: null, chaves: [] },
]

/** Arrays textuais — o valor é uma LISTA, então conta-se elemento a elemento. */
const ARRAYS = [
  { tabela: 'CondicaoPagamento', coluna: 'modalidades', destino: 'ModalidadePais', chaves: ['modalityKey', 'modalityLabel'] },
  { tabela: 'TaxaPagamento', coluna: 'modalidades', destino: 'ModalidadePais', chaves: ['modalityKey', 'modalityLabel'] },
]

async function cadastro(nome, chaves) {
  if (!nome) return null
  const delegate = nome.charAt(0).toLowerCase() + nome.slice(1)
  const sel = Object.fromEntries(chaves.map((c) => [c, true]))
  const linhas = await prisma[delegate].findMany({ select: { id: true, ...sel } }).catch(() => null)
  if (!linhas) return null
  const idx = new Map()
  for (const l of linhas) for (const c of chaves) { const k = norm(l[c]); if (k) idx.set(k, l.id) }
  return { total: linhas.length, idx }
}

async function valores(tabela, coluna, array = false) {
  const sql = array
    ? `SELECT unnest("${coluna}") AS v, count(*)::int AS n FROM "${tabela}" WHERE "${coluna}" IS NOT NULL GROUP BY 1 ORDER BY 2 DESC`
    : `SELECT "${coluna}" AS v, count(*)::int AS n FROM "${tabela}" WHERE "${coluna}" IS NOT NULL AND btrim("${coluna}") <> '' GROUP BY 1 ORDER BY 2 DESC`
  return prisma.$queryRawUnsafe(sql).catch((e) => ({ erro: String(e?.message ?? e).slice(0, 90) }))
}

async function auditar(d, array = false) {
  const rows = await valores(d.tabela, d.coluna, array)
  if (!Array.isArray(rows)) {
    console.log(`[audit-ref] ${d.tabela}.${d.coluna} — não consultável (${rows?.erro ?? 'coluna ausente'})`)
    return { linhas: 0, distintos: 0, resolvem: 0, naoResolvem: [] }
  }
  const linhas = rows.reduce((a, r) => a + Number(r.n), 0)
  if (linhas === 0) {
    console.log(`[audit-ref] ${d.tabela}.${d.coluna} — VAZIO (0 linhas com valor) → remoção direta, sem backfill`)
    return { linhas: 0, distintos: 0, resolvem: 0, naoResolvem: [] }
  }
  const cad = await cadastro(d.destino, d.chaves)
  let resolvem = 0
  const naoResolvem = []
  for (const r of rows) {
    const k = norm(r.v)
    if (cad?.idx.has(k)) resolvem += Number(r.n)
    else naoResolvem.push(`"${r.v}"×${r.n}`)
  }
  const destino = d.destino ? `→ ${d.destino} (${cad ? cad.total : '?'} registros)` : '→ SEM cadastro oficial correspondente'
  console.log(`[audit-ref] ${d.tabela}.${d.coluna}${array ? '[]' : ''} — ${linhas} valor(es), ${rows.length} distinto(s) ${destino}`)
  console.log(`[audit-ref]     resolvem: ${resolvem}/${linhas} · NÃO resolvem: ${naoResolvem.length} distinto(s)`)
  if (naoResolvem.length) console.log(`[audit-ref]     sem correspondência: ${naoResolvem.slice(0, 12).join(', ')}${naoResolvem.length > 12 ? ` …+${naoResolvem.length - 12}` : ''}`)
  return { linhas, distintos: rows.length, resolvem, naoResolvem }
}

async function main() {
  const retrato = await retratar(prisma)
  console.log(`[audit-ref] alvo: ${identificador(url)} (tabelas=${retrato.tabelas}, migrations=${retrato.migrations})`)
  console.log(`[audit-ref] ${DIVIDAS.length + ARRAYS.length} dívidas de referência textual\n`)

  let vazias = 0, limpas = 0, bloqueadas = 0
  for (const d of DIVIDAS) {
    const r = await auditar(d)
    if (r.linhas === 0) vazias++
    else if (r.naoResolvem.length === 0) limpas++
    else bloqueadas++
  }
  for (const d of ARRAYS) {
    const r = await auditar(d, true)
    if (r.linhas === 0) vazias++
    else if (r.naoResolvem.length === 0) limpas++
    else bloqueadas++
  }

  console.log(`\n[audit-ref] VEREDITO`)
  console.log(`[audit-ref]   sem dado (remoção direta): ${vazias}`)
  console.log(`[audit-ref]   backfill determinístico:   ${limpas}`)
  console.log(`[audit-ref]   exigem decisão humana:     ${bloqueadas}`)
  await prisma.$disconnect()
}

main().catch(async (e) => {
  console.log(`[audit-ref] AVISO: auditoria não concluída (${String(e?.message ?? e).slice(0, 200)})`)
  await prisma.$disconnect()
})
