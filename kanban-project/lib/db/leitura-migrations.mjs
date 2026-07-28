// lib/db/leitura-migrations.mjs
// ============================================================================
// LEITURA DAS MIGRATIONS E DO CATÁLOGO DO POSTGRES — fonte única.
//
// Converte cada `migration.sql` numa lista de ASSERÇÕES verificáveis contra o
// catálogo real (tabela/coluna/índice/constraint/tipo/valor de enum/nulabilidade)
// e coleta o estado do banco numa única passada. Usado pelo baseline (para saber
// o que já está refletido) e pela validação pós-deploy (para provar que o que
// devia entrar entrou).
//
// Não escreve nada. Não conhece produção. Só lê.
// ============================================================================
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/** Nomes das migrations do repositório, em ordem lexicográfica (= cronológica). */
export function listarMigrations(dir) {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && fs.existsSync(path.join(dir, d.name, 'migration.sql')))
    .map((d) => d.name)
    .sort()
}

export const sqlDaMigration = (dir, nome) => fs.readFileSync(path.join(dir, nome, 'migration.sql'), 'utf8')

/**
 * Comentários fora primeiro (um `--` pode citar `$$`), depois os blocos DO $$…$$
 * — idempotentes por construção neste repositório. O resto vira statements.
 * Retorna null se sobrar um `$$` que não soubemos delimitar.
 */
export function statements(sql) {
  const semComentario = sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ')
  const semDo = semComentario.replace(/DO\s*\$\$[\s\S]*?\$\$/gi, ' ')
  if (semDo.includes('$$')) return null
  return semDo
    .split(';')
    .map((s) => s.trim().replace(/\s+/g, ' '))
    .filter(Boolean)
}

export const semAspas = (s) =>
  String(s)
    .replace(/"/g, '')
    .replace(/^public\./, '')

/** Identificador SQL: `X`, `"X"` ou `"public"."X"`. `§` no corpo vira esse padrão. */
const NOME = '((?:"[^"]+"|\\w+)(?:\\.(?:"[^"]+"|\\w+))?)'
export const re = (corpo, flags = 'i') => new RegExp(corpo.replace(/§/g, NOME), flags)

/** Asserções verificáveis de uma migration. null = SQL não parseável. */
export function asserçoes(sql) {
  const sts = statements(sql)
  if (sts === null) return null
  const out = []
  const add = (tipo, chave, presente) => out.push({ tipo, chave, presente })

  for (const st of sts) {
    let m
    if ((m = st.match(re('^CREATE\\s+TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?§')))) {
      add('tabela', semAspas(m[1]), true)
    } else if ((m = st.match(re('^DROP\\s+TABLE\\s+(?:IF\\s+EXISTS\\s+)?§')))) {
      add('tabela', semAspas(m[1]), false)
    } else if ((m = st.match(re('^CREATE\\s+(?:UNIQUE\\s+)?INDEX\\s+(?:CONCURRENTLY\\s+)?(?:IF\\s+NOT\\s+EXISTS\\s+)?§')))) {
      add('indice', semAspas(m[1]), true)
    } else if ((m = st.match(re('^DROP\\s+INDEX\\s+(?:IF\\s+EXISTS\\s+)?§')))) {
      add('indice', semAspas(m[1]), false)
    } else if ((m = st.match(re('^CREATE\\s+TYPE\\s+§')))) {
      add('tipo', semAspas(m[1]), true)
    } else if ((m = st.match(re('^DROP\\s+TYPE\\s+(?:IF\\s+EXISTS\\s+)?§')))) {
      add('tipo', semAspas(m[1]), false)
    } else if ((m = st.match(re("^ALTER\\s+TYPE\\s+§\\s+ADD\\s+VALUE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?'([^']+)'")))) {
      add('enumvalor', `${semAspas(m[1])}.${m[2]}`, true)
    } else if ((m = st.match(re('^ALTER\\s+TABLE\\s+(?:ONLY\\s+)?§\\s+([\\s\\S]+)$')))) {
      const tabela = semAspas(m[1])
      const resto = m[2]
      let a
      const rAddCol = re('ADD\\s+COLUMN\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?§', 'gi')
      while ((a = rAddCol.exec(resto))) add('coluna', `${tabela}.${semAspas(a[1])}`, true)
      const rDropCol = re('DROP\\s+COLUMN\\s+(?:IF\\s+EXISTS\\s+)?§', 'gi')
      while ((a = rDropCol.exec(resto))) add('coluna', `${tabela}.${semAspas(a[1])}`, false)
      const rAddCon = re('ADD\\s+CONSTRAINT\\s+§', 'gi')
      while ((a = rAddCon.exec(resto))) add('constraint', semAspas(a[1]), true)
      const rDropCon = re('DROP\\s+CONSTRAINT\\s+(?:IF\\s+EXISTS\\s+)?§', 'gi')
      while ((a = rDropCon.exec(resto))) add('constraint', semAspas(a[1]), false)
      const rNull = re('ALTER\\s+(?:COLUMN\\s+)?§\\s+(DROP|SET)\\s+NOT\\s+NULL', 'gi')
      while ((a = rNull.exec(resto))) add('nulavel', `${tabela}.${semAspas(a[1])}`, a[2].toUpperCase() === 'DROP')
    }
  }
  // O arquivo roda em ordem: o padrão idempotente `DROP CONSTRAINT IF EXISTS x`
  // seguido de `ADD CONSTRAINT x` termina COM a constraint. Vale a última palavra
  // sobre cada objeto, não a primeira.
  const ultima = new Map()
  for (const a of out) ultima.set(`${a.tipo}:${a.chave}`, a)
  return [...ultima.values()]
}

/** Estado do schema numa passada só. Devolve os conjuntos e o avaliador `existe`. */
export async function coletarCatalogo(prisma) {
  const q = (s) => prisma.$queryRawUnsafe(s)
  const conjunto = async (sql, fn) => new Set((await q(sql)).map(fn))

  const tabelas = await conjunto(
    `SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'`,
    (r) => r.table_name,
  )
  const colunas = await conjunto(
    `SELECT table_name, column_name FROM information_schema.columns WHERE table_schema='public'`,
    (r) => `${r.table_name}.${r.column_name}`,
  )
  const nulaveis = await conjunto(
    `SELECT table_name, column_name FROM information_schema.columns WHERE table_schema='public' AND is_nullable='YES'`,
    (r) => `${r.table_name}.${r.column_name}`,
  )
  const indices = await conjunto(`SELECT indexname FROM pg_indexes WHERE schemaname='public'`, (r) => r.indexname)
  const constraints = await conjunto(
    `SELECT c.conname FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE n.nspname='public'`,
    (r) => r.conname,
  )
  const tipos = await conjunto(
    `SELECT t.typname FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='public' AND t.typtype='e'`,
    (r) => r.typname,
  )
  const enumValores = await conjunto(
    `SELECT t.typname, e.enumlabel FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='public'`,
    (r) => `${r.typname}.${r.enumlabel}`,
  )

  const existe = (a) => {
    switch (a.tipo) {
      case 'tabela': return tabelas.has(a.chave)
      case 'coluna': return colunas.has(a.chave)
      case 'indice': return indices.has(a.chave)
      // O Postgres materializa UNIQUE/PK como índice; o nome vive nos dois catálogos.
      case 'constraint': return constraints.has(a.chave) || indices.has(a.chave)
      case 'tipo': return tipos.has(a.chave)
      case 'enumvalor': return enumValores.has(a.chave)
      case 'nulavel': return nulaveis.has(a.chave)
      default: return false
    }
  }

  return { tabelas, colunas, nulaveis, indices, constraints, tipos, enumValores, existe }
}

/** Classifica uma migration contra o catálogo: REFLETIDA | PARCIAL | PENDENTE | INDETERMINADA. */
export function classificarMigration(sql, existe) {
  const as_ = asserçoes(sql)
  if (as_ === null || as_.length === 0) return { estado: 'INDETERMINADA', ok: 0, total: 0, falhas: [] }
  const falhas = as_.filter((a) => existe(a) !== a.presente)
  const ok = as_.length - falhas.length
  const estado = falhas.length === 0 ? 'REFLETIDA' : ok === 0 ? 'PENDENTE' : 'PARCIAL'
  return {
    estado,
    ok,
    total: as_.length,
    falhas: falhas.map((f) => `${f.tipo}:${f.chave}${f.presente ? '' : ' (deveria estar ausente)'}`),
  }
}

/**
 * Onde o baseline registra o CORTE (prefixo baselinado × pendentes) para que a
 * validação pós-`migrate deploy`, no MESMO build, saiba exatamente o que tinha
 * de entrar. Ausente = a validação roda em modo informativo.
 */
export const ARQUIVO_CORTE = path.join(os.tmpdir(), 'homolog-corte.json')
