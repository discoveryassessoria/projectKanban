#!/usr/bin/env node
// scripts/preview-bootstrap-banco-vazio.mjs
// ============================================================================
// PREPARA UM BANCO NOVO E VAZIO (homologação/Preview) PARA RECEBER O `migrate deploy`.
//
// POR QUE EXISTE: `prisma migrate deploy` num banco VAZIO tentaria reexecutar as 70
// migrations "absorvidas" pelo baseline por cima do próprio baseline — elas nunca foram
// feitas para isso. O gate de CI monta o banco de teste em 3 passos (baseline.sql →
// livro-razão marcando baseline + absorvidas como aplicadas → migrate deploy). Este script
// faz os DOIS PRIMEIROS passos num banco remoto de homologação. O terceiro (`migrate
// deploy`, as migrations posteriores ao baseline) fica com o build do Preview
// (`prod-migrate-guard.mjs`, MIGRATE_ON_BUILD=1), exatamente como já é hoje.
//
// NÃO toca no guard, NÃO lê `.env`, NÃO grava a URL em lugar nenhum.
//
// COMO USAR (a URL só existe na variável de ambiente do seu terminal, nunca em argumento):
//   read -s BOOTSTRAP_DATABASE_URL; export BOOTSTRAP_DATABASE_URL          # cola a URL direta da Neon
//   node scripts/preview-bootstrap-banco-vazio.mjs                          # SIMULAÇÃO: só mostra o plano
//   node scripts/preview-bootstrap-banco-vazio.mjs --confirmo-escrever      # escreve de verdade
//   unset BOOTSTRAP_DATABASE_URL
//
// TRAVAS (qualquer uma aborta antes de escrever):
//   • URL só pela variável BOOTSTRAP_DATABASE_URL (URL em argumento é recusada);
//   • host `db.prisma.io` / `pooled.db.prisma.io` (Prisma Postgres = produção) é recusado;
//   • banco que já tenha QUALQUER tabela (inclusive `_prisma_migrations`) é recusado;
//   • sem `--confirmo-escrever` é só simulação (apenas SELECTs de leitura);
//   • o baseline.sql tem de ser byte a byte o de `prisma/migrations/0000_baseline`.
// Imprime só host e nome do banco — nunca usuário, senha ou a URL.
// ============================================================================
import { execFileSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..')
const ESCREVER = process.argv.includes('--confirmo-escrever')
const PRISMA = join(RAIZ, 'node_modules', '.bin', 'prisma')

const URL_BRUTA = process.env.BOOTSTRAP_DATABASE_URL ?? ''

/** Remove a URL (e a senha dela) de qualquer texto antes de imprimir. */
function limpar(texto) {
  let t = String(texto)
  if (URL_BRUTA) t = t.split(URL_BRUTA).join('«url»')
  try {
    const senha = decodeURIComponent(new URL(URL_BRUTA).password)
    if (senha) t = t.split(senha).join('«senha»')
  } catch { /* URL inválida: já foi recusada */ }
  return t
}
const abortar = (msg) => {
  console.error(`⛔ ${limpar(msg)}`)
  console.error('Nada foi escrito.')
  process.exit(1)
}

// ── 1) a URL só vem pela variável; nunca por argumento ──────────────────────
if (process.argv.slice(2).some((a) => /^[a-z]+:\/\//i.test(a) || /postgres/i.test(a))) {
  abortar('Não passe a URL como argumento (ela ficaria no histórico do terminal). Use a variável BOOTSTRAP_DATABASE_URL.')
}
if (!URL_BRUTA) abortar('Defina BOOTSTRAP_DATABASE_URL com a URL do banco NOVO (use `read -s BOOTSTRAP_DATABASE_URL`).')

let alvo
try { alvo = new URL(URL_BRUTA) } catch { abortar('BOOTSTRAP_DATABASE_URL não é uma URL válida.') }
if (!/^postgres(ql)?:$/.test(alvo.protocol)) abortar('A URL precisa ser postgresql://.')
const HOST = alvo.hostname.toLowerCase()
const BANCO = decodeURIComponent(alvo.pathname.replace(/^\//, '')) || '(sem nome)'

// ── 2) produção nunca ───────────────────────────────────────────────────────
if (/(^|\.)db\.prisma\.io$/.test(HOST)) {
  abortar(`Host ${HOST} é o Prisma Postgres (PRODUÇÃO). Este script só prepara bancos de homologação.`)
}

console.log(`Alvo: ${HOST} / banco "${BANCO}"`)
console.log(ESCREVER ? 'Modo: ESCREVER (--confirmo-escrever)' : 'Modo: SIMULAÇÃO (nenhuma escrita)')

// ── 3) o que seria aplicado ─────────────────────────────────────────────────
const arquivoBaseline = join(RAIZ, 'prisma/baseline/baseline.sql')
const arquivoMigrationBaseline = join(RAIZ, 'prisma/migrations/0000_baseline/migration.sql')
const arquivoManifesto = join(RAIZ, 'prisma/baseline/migrations-absorvidas.json')
for (const f of [arquivoBaseline, arquivoMigrationBaseline, arquivoManifesto, PRISMA]) {
  if (!existsSync(f)) abortar(`Arquivo esperado não encontrado: ${f.replace(RAIZ + '/', '')}`)
}
const baselineSql = readFileSync(arquivoBaseline)
const sha = (b) => createHash('sha256').update(b).digest('hex')
if (sha(baselineSql) !== sha(readFileSync(arquivoMigrationBaseline))) {
  abortar('prisma/baseline/baseline.sql difere de prisma/migrations/0000_baseline/migration.sql — recuso (o checksum do baseline é imutável).')
}
const absorvidas = JSON.parse(readFileSync(arquivoManifesto, 'utf8')).migrationsAbsorvidas
for (const nome of absorvidas) {
  if (!existsSync(join(RAIZ, 'prisma/migrations', nome, 'migration.sql'))) abortar(`Migration absorvida sem arquivo: ${nome}`)
}

// ── 4) o banco TEM de estar vazio (só leitura) ──────────────────────────────
const cliente = () => new pg.Client({ connectionString: URL_BRUTA, connectionTimeoutMillis: 20000 })
async function tabelasExistentes() {
  const c = cliente()
  await c.connect()
  try {
    const r = await c.query(
      `SELECT table_schema, table_name FROM information_schema.tables
        WHERE table_schema NOT IN ('pg_catalog','information_schema') AND table_type = 'BASE TABLE'`)
    return r.rows
  } finally { await c.end() }
}

let existentes
try { existentes = await tabelasExistentes() } catch (e) { abortar(`Não consegui ler o banco: ${e.message}`) }
if (existentes.length > 0) {
  abortar(`O banco NÃO está vazio (${existentes.length} tabela(s) encontrada(s)). Recuso — este script só prepara banco novo.`)
}
console.log('✔ Banco vazio (0 tabelas).')

console.log('\nPlano:')
console.log(`  1. executar o baseline.sql (${(baselineSql.length / 1024).toFixed(0)} KB) — cria o schema inteiro, numa transação só;`)
console.log('  2. criar o livro-razão `_prisma_migrations` marcando 0000_baseline como aplicada;')
console.log(`  3. registrar as ${absorvidas.length} migrations absorvidas como aplicadas (sem reexecutar o SQL delas);`)
console.log('  4. conferir: o livro-razão tem exatamente as linhas esperadas e o banco deixou de estar vazio.')
console.log('  (as migrations posteriores ao baseline NÃO são aplicadas aqui: ficam para o build do Preview)')

if (!ESCREVER) {
  console.log('\nSimulação concluída. Nada foi escrito. Para escrever, rode de novo com --confirmo-escrever.')
  process.exit(0)
}

// ── 5) escrever ─────────────────────────────────────────────────────────────
try {
  console.log('\n▶ 1/4 baseline.sql…')
  {
    const c = cliente(); await c.connect()
    try { await c.query(baselineSql.toString('utf8')) } finally { await c.end() }
  }
  console.log('▶ 2/4 livro-razão com 0000_baseline…')
  const env = { ...process.env, PRISMA_DATABASE_URL: URL_BRUTA, DIRECT_DATABASE_URL: URL_BRUTA }
  execFileSync(PRISMA, ['migrate', 'resolve', '--applied', '0000_baseline'], { env, cwd: RAIZ, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 })
  console.log(`▶ 3/4 ${absorvidas.length} migrations absorvidas…`)
  {
    const c = cliente(); await c.connect()
    try {
      await c.query('BEGIN')
      for (const nome of absorvidas) {
        const checksum = sha(readFileSync(join(RAIZ, 'prisma/migrations', nome, 'migration.sql')))
        await c.query(
          `INSERT INTO "_prisma_migrations" (id, checksum, finished_at, migration_name, logs, started_at, applied_steps_count)
           VALUES ($1, $2, now(), $3, NULL, now(), 0)`, [randomUUID(), checksum, nome])
      }
      await c.query('COMMIT')
    } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e } finally { await c.end() }
  }
  console.log('▶ 4/4 conferência…')
  const c = cliente(); await c.connect()
  try {
    const livro = (await c.query('SELECT count(*)::int AS n FROM "_prisma_migrations"')).rows[0].n
    const tabelas = (await c.query(`SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`)).rows[0].n
    const esperado = 1 + absorvidas.length
    if (livro !== esperado) throw new Error(`livro-razão com ${livro} linha(s); esperado ${esperado}`)
    if (tabelas < 50) throw new Error(`só ${tabelas} tabela(s) no schema; o baseline deveria ter criado o schema inteiro`)
    console.log(`✔ livro-razão: ${livro} migrations registradas · ${tabelas} tabelas no schema`)
  } finally { await c.end() }
  console.log('\n✅ Banco preparado. Agora o build do Preview (MIGRATE_ON_BUILD=1) aplica só as migrations posteriores ao baseline.')
} catch (e) {
  console.error(`\n⛔ Falhou no meio: ${limpar(e.message ?? e)}`)
  console.error('O banco pode ter ficado parcialmente preparado. Apague o banco/branch novo na Neon e crie outro vazio antes de tentar de novo.')
  process.exit(1)
}
