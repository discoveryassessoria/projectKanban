// scripts/homolog-baseline.mjs
// ============================================================================
// BASELINE DO BANCO DE HOMOLOGAÇÃO (P3005) — analisar / aplicar.
//
// Contexto: o banco de homologação foi criado a partir do schema (135 tabelas)
// SEM histórico em `_prisma_migrations`. O Prisma aborta com P3005 ("database
// schema is not empty") e nenhuma migration é aplicada. A correção correta é
// BASELINE: marcar como aplicadas apenas as migrations JÁ refletidas no schema,
// deixando as pendentes para o `migrate deploy`.
//
// Este script NÃO usa `db push`, NÃO usa `migrate reset`, NÃO recria banco e
// NÃO toca dado de negócio. A única escrita que faz é
// `prisma migrate resolve --applied <migration>`, que insere linha em
// `_prisma_migrations`.
//
// Modos (env HOMOLOG_BASELINE):
//   analisar → só relata (nenhuma escrita)
//   aplicar  → relata e executa o baseline
//   (ausente) → no-op
//
// Trava dura: só roda em VERCEL_ENV=preview e aborta se o banco tiver
// assinatura de PRODUÇÃO.
// ============================================================================
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { CLASSE, classificar, identificador, retratar } from '../lib/db/identidade-banco.mjs'

const MODO = (process.env.HOMOLOG_BASELINE || '').toLowerCase()
if (!MODO) {
  console.log('[baseline] desligado (HOMOLOG_BASELINE ausente) — seguindo o build.')
  process.exit(0)
}
if (!['analisar', 'aplicar'].includes(MODO)) {
  console.error(`[baseline] ABORTADO: HOMOLOG_BASELINE inválido (${MODO}). Use analisar|aplicar.`)
  process.exit(1)
}

const abortar = (msg) => {
  console.error(`[baseline] ABORTADO: ${msg}`)
  console.error('[baseline] Nenhuma escrita foi feita.')
  process.exit(1)
}

if (process.env.VERCEL_ENV && process.env.VERCEL_ENV !== 'preview') {
  abortar(`só roda em Preview (VERCEL_ENV=${process.env.VERCEL_ENV}).`)
}

const url = process.env.PRISMA_DATABASE_URL
if (!url) abortar('PRISMA_DATABASE_URL ausente.')

// Produção roda em Prisma Postgres (db.prisma.io). Homologação, não. Trava barata
// e definitiva contra o alvo errado — vale ANTES de qualquer conexão.
if (/db\.prisma\.io/i.test(identificador(url))) {
  abortar('o alvo é db.prisma.io (Prisma Postgres = produção). Baseline só roda em homologação.')
}

// ---------------------------------------------------------------- inventário
const DIR = path.join(process.cwd(), 'prisma', 'migrations')
const migrations = fs
  .readdirSync(DIR, { withFileTypes: true })
  .filter((d) => d.isDirectory() && fs.existsSync(path.join(DIR, d.name, 'migration.sql')))
  .map((d) => d.name)
  .sort()

const sqlDe = (nome) => fs.readFileSync(path.join(DIR, nome, 'migration.sql'), 'utf8')

/**
 * Comentários fora primeiro (um `--` pode citar `$$`), depois os blocos DO $$…$$
 * — que são idempotentes por construção neste repositório e não têm DDL
 * verificável fora deles. O resto vira statements.
 */
function statements(sql) {
  const semComentario = sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ')
  const semDo = semComentario.replace(/DO\s*\$\$[\s\S]*?\$\$/gi, ' ')
  if (semDo.includes('$$')) return null // bloco $$ que não soubemos delimitar
  return semDo
    .split(';')
    .map((s) => s.trim().replace(/\s+/g, ' '))
    .filter(Boolean)
}

const semAspas = (s) =>
  String(s)
    .replace(/"/g, '')
    .replace(/^public\./, '')

// Identificador SQL: `X`, `"X"` ou `"public"."X"`.
const NOME = '((?:"[^"]+"|\\w+)(?:\\.(?:"[^"]+"|\\w+))?)'
const re = (corpo, flags = 'i') => new RegExp(corpo.replace(/§/g, NOME), flags)

/** Extrai asserções verificáveis contra o catálogo do Postgres. */
function asserçoes(sql) {
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
      while ((a = rNull.exec(resto))) {
        add('nulavel', `${tabela}.${semAspas(a[1])}`, a[2].toUpperCase() === 'DROP')
      }
    }
  }
  return out
}

// --------------------------------------------------------- estado real do BD
const { PrismaClient } = await import('@prisma/client')
const prisma = new PrismaClient({ datasources: { db: { url } } })

let saida = 0
try {
  console.log('='.repeat(78))
  console.log(`[baseline] modo: ${MODO.toUpperCase()}`)
  console.log(`[baseline] alvo: ${identificador(url)}`)

  // ---- PROVA 1: o alvo não é produção
  const retrato = await retratar(prisma)
  const classe = classificar(retrato)
  console.log(
    `[baseline] retrato: ${retrato.tabelas} tabelas · ${retrato.migrations} migrations aplicadas · ${retrato.requerentes} requerentes`,
  )
  console.log(`[baseline] classificação: ${classe}`)
  if (classe === CLASSE.PRODUCAO) abortar('o alvo tem ASSINATURA DE PRODUÇÃO. Proibido.')
  console.log('[baseline] PROVA OK — alvo NÃO é produção.')

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

  const nulaveis = await conjunto(
    `SELECT table_name, column_name FROM information_schema.columns WHERE table_schema='public' AND is_nullable='YES'`,
    (r) => `${r.table_name}.${r.column_name}`,
  )

  const existe = (a) => {
    switch (a.tipo) {
      case 'tabela': return tabelas.has(a.chave)
      case 'coluna': return colunas.has(a.chave)
      case 'indice': return indices.has(a.chave)
      case 'constraint': return constraints.has(a.chave) || indices.has(a.chave)
      case 'tipo': return tipos.has(a.chave)
      case 'enumvalor': return enumValores.has(a.chave)
      case 'nulavel': return nulaveis.has(a.chave)
      default: return false
    }
  }

  // ------------------------------------------------------------- classificação
  const linhas = migrations.map((nome) => {
    const as_ = asserçoes(sqlDe(nome))
    if (as_ === null || as_.length === 0) {
      return { nome, estado: 'INDETERMINADA', ok: 0, total: 0, falhas: [] }
    }
    const falhas = as_.filter((a) => existe(a) !== a.presente)
    const ok = as_.length - falhas.length
    const estado = falhas.length === 0 ? 'REFLETIDA' : ok === 0 ? 'PENDENTE' : 'PARCIAL'
    return { nome, estado, ok, total: as_.length, falhas: falhas.map((f) => `${f.tipo}:${f.chave}${f.presente ? '' : ' (deveria estar ausente)'}`) }
  })

  const jaAplicadas = new Set(
    (await q(`SELECT migration_name FROM _prisma_migrations`).catch(() => [])).map((r) => r.migration_name),
  )

  console.log('\n' + '='.repeat(78))
  console.log(`INVENTÁRIO — ${migrations.length} migrations no repositório`)
  console.log('='.repeat(78))
  for (const l of linhas) {
    const marca = jaAplicadas.has(l.nome) ? ' [já em _prisma_migrations]' : ''
    console.log(`  ${l.estado.padEnd(14)} ${l.nome} (${l.ok}/${l.total})${marca}`)
    for (const f of l.falhas.slice(0, 6)) console.log(`        ↳ falta ${f}`)
  }

  const pendentes = linhas.filter((l) => l.estado === 'PENDENTE')
  const parciais = linhas.filter((l) => l.estado === 'PARCIAL')
  const indeterminadas = linhas.filter((l) => l.estado === 'INDETERMINADA')
  const refletidas = linhas.filter((l) => l.estado === 'REFLETIDA')

  console.log('\nRESUMO')
  console.log(`  total .............: ${linhas.length}`)
  console.log(`  REFLETIDA .........: ${refletidas.length}`)
  console.log(`  INDETERMINADA .....: ${indeterminadas.length} (sem DDL verificável — segue a posição)`)
  console.log(`  PARCIAL ...........: ${parciais.length}`)
  console.log(`  PENDENTE ..........: ${pendentes.length}`)

  // ---------------------------------------------------------------- o CORTE
  // O schema de homologação NÃO foi construído migration a migration: nasceu de
  // um `db push` do schema.prisma de uma data X. Logo ele reflete o ESTADO FINAL
  // daquela data, não cada passo histórico — migrations antigas que criaram algo
  // depois removido, ou CHECK/EXCLUDE que o Prisma não modela, aparecem como
  // PARCIAL. Isso é esperado e não invalida o baseline.
  //
  // O corte é o ÚLTIMO ponto em que o schema ainda bate: depois da última
  // migration integralmente REFLETIDA. Dali para frente é gap real.
  let idxUltimaRefletida = -1
  linhas.forEach((l, i) => { if (l.estado === 'REFLETIDA') idxUltimaRefletida = i })
  const cabeca = linhas.slice(0, idxUltimaRefletida + 1)
  const cauda = linhas.slice(idxUltimaRefletida + 1)
  const caudaLimpa = cauda.filter((l) => l.estado === 'REFLETIDA')
  const cabecaSuja = cabeca.filter((l) => l.estado !== 'REFLETIDA')

  console.log(`\nCORTE: após ${cabeca.at(-1)?.nome ?? '(nenhuma)'}`)

  console.log('\nA MARCAR COMO APLICADAS (baseline) — prefixo pré-existente:')
  for (const l of cabeca) console.log(`  ✓ ${l.nome}${jaAplicadas.has(l.nome) ? ' [já registrada]' : ''}`)
  console.log(`  → ${cabeca.length} migrations`)

  console.log('\nA PERMANECER PENDENTES (aplicadas pelo migrate deploy):')
  for (const l of cauda) console.log(`  ○ ${l.estado.padEnd(14)} ${l.nome}`)
  console.log(`  → ${cauda.length} migrations`)

  if (cabecaSuja.length) {
    console.log('\n⚠ LACUNA ESTRUTURAL do prefixo (objetos que o baseline dá como aplicados,')
    console.log('  mas que NÃO existem no schema de homologação — em geral CHECK/EXCLUDE que o')
    console.log('  Prisma não modela, ou objetos criados e depois removidos por migration posterior):')
    for (const l of cabecaSuja) {
      console.log(`   ${l.nome} (${l.ok}/${l.total})`)
      for (const f of l.falhas) console.log(`      · ${f}`)
    }
  }
  if (caudaLimpa.length) {
    console.log('\n⚠ ATENÇÃO: migration JÁ refletida DEPOIS do corte (migrate deploy pode falhar):')
    for (const l of caudaLimpa) console.log(`   ${l.nome}`)
  }

  // ---- PRÉ-VOO: as pendentes só aplicam se os objetos que elas REFERENCIAM existem
  console.log('\nPRÉ-VOO das pendentes — dependências referenciadas:')
  const faltando = new Set()
  for (const l of cauda) {
    const sql = sqlDe(l.nome)
    const alvos = new Set()
    let a
    const rRef = re('REFERENCES\\s+§', 'gi')
    while ((a = rRef.exec(sql))) alvos.add(semAspas(a[1]))
    const rTipo = /"([A-Z]\w+)"(?=\s|,|\)|$)/g
    while ((a = rTipo.exec(sql))) if (tipos.has(a[1])) alvos.add(a[1])
    const ausentes = [...alvos].filter((t) => !tabelas.has(t) && !tipos.has(t) && !cauda.some((c) => sqlDe(c.nome).includes(`CREATE TABLE IF NOT EXISTS "${t}"`) || sqlDe(c.nome).includes(`CREATE TABLE "${t}"`)))
    if (ausentes.length) {
      ausentes.forEach((t) => faltando.add(t))
      console.log(`  ✗ ${l.nome} → falta ${ausentes.join(', ')}`)
    } else {
      console.log(`  ✓ ${l.nome} → ${[...alvos].join(', ') || '(sem dependência externa)'}`)
    }
  }
  if (faltando.size) {
    console.log(`  ⚠ objetos referenciados e inexistentes: ${[...faltando].join(', ')}`)
  }

  if (MODO === 'analisar') {
    console.log('\n[baseline] MODO ANALISAR — nenhuma escrita feita.')
  } else {
    if (caudaLimpa.length) {
      abortar('há migration já refletida depois do corte — baseline inseguro. Revise antes de aplicar.')
    }
    console.log('\n[baseline] APLICANDO baseline (prisma migrate resolve --applied) ...')
    const bin = path.join(process.cwd(), 'node_modules', '.bin', 'prisma')
    let feitas = 0
    let puladas = 0
    for (const l of cabeca) {
      if (jaAplicadas.has(l.nome)) { puladas++; continue }
      execFileSync(bin, ['migrate', 'resolve', '--applied', l.nome], {
        stdio: ['ignore', 'ignore', 'inherit'],
        env: { ...process.env, DIRECT_DATABASE_URL: url },
      })
      feitas++
      if (feitas % 10 === 0) console.log(`  ... ${feitas}/${cabeca.length}`)
    }
    console.log(`[baseline] resolve: ${feitas} marcadas · ${puladas} já registradas.`)

    const depois = await q(`SELECT migration_name, finished_at, rolled_back_at FROM _prisma_migrations ORDER BY migration_name`)
    console.log(`[baseline] _prisma_migrations agora tem ${depois.length} linhas.`)
    const inacabadas = depois.filter((r) => !r.finished_at || r.rolled_back_at)
    if (inacabadas.length) abortar(`linhas inacabadas em _prisma_migrations: ${inacabadas.map((r) => r.migration_name).join(', ')}`)
    const indevidas = depois.filter((r) => cauda.some((l) => l.nome === r.migration_name))
    if (indevidas.length) abortar(`migration pendente marcada indevidamente: ${indevidas.map((r) => r.migration_name).join(', ')}`)
    if (depois.length !== cabeca.length) {
      abortar(`esperado ${cabeca.length} linhas, encontrado ${depois.length}.`)
    }
    console.log('[baseline] VALIDADO — baseline correto, pendentes intactas.')
  }
  console.log('='.repeat(78))
} catch (err) {
  console.error('[baseline] ERRO:', String(err?.message ?? err).slice(0, 500))
  saida = 1
} finally {
  await prisma.$disconnect()
}
process.exit(saida)
