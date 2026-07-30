// scripts/mrg-banco-teste.mjs
// ============================================================================
// BANCO DE TESTE LOCAL para o Motor Registral Genealógico (MRG).
//
// Por que existe: o E2E do MRG ESCREVE (cria pessoas, aplica propostas, reverte).
// Rodar isso contra o banco oficial é inaceitável. Este script levanta um
// PostgreSQL local isolado, aplica o schema e roda o E2E apontado para ele.
//
// Uso:
//   node scripts/mrg-banco-teste.mjs up        → sobe o banco e aplica o schema
//   node scripts/mrg-banco-teste.mjs run-e2e   → roda o E2E contra o banco local
//   node scripts/mrg-banco-teste.mjs migration → aplica a migration do MRG e checa drift
//   node scripts/mrg-banco-teste.mjs down      → derruba o banco
//
// Requisito: PostgreSQL instalado localmente (initdb/pg_ctl no PATH ou em
// PG_BIN). Nada é instalado por este script.
// ============================================================================
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import os from 'node:os'

const ACAO = (process.argv[2] || '').toLowerCase()
const PORTA = process.env.MRG_TEST_PORT || '55432'
const BANCO = process.env.MRG_TEST_DB || 'discovery_test'
const DIR_DADOS = process.env.MRG_TEST_PGDATA || join(os.tmpdir(), 'mrg-pgdata')
// Socket em diretório curto: o Unix socket do Postgres tem limite de 103 bytes.
const DIR_SOCKET = process.env.MRG_TEST_SOCKET || join(os.tmpdir(), 'mrg-sock')
const URL = `postgresql://postgres@127.0.0.1:${PORTA}/${BANCO}`

function bin(nome) {
  const candidatos = [
    process.env.PG_BIN ? join(process.env.PG_BIN, nome) : null,
    `/opt/homebrew/opt/postgresql@16/bin/${nome}`,
    `/usr/local/opt/postgresql@16/bin/${nome}`,
    nome,
  ].filter(Boolean)
  for (const c of candidatos) {
    const r = spawnSync(c, ['--version'], { stdio: 'ignore' })
    if (r.status === 0) return c
  }
  throw new Error(
    `${nome} não encontrado. Instale o PostgreSQL localmente ou aponte PG_BIN para o diretório dos binários.`,
  )
}

function rodar(cmd, args, env = {}) {
  const r = spawnSync(cmd, args, { stdio: 'inherit', env: { ...process.env, ...env } })
  if (r.status !== 0) process.exit(r.status ?? 1)
}

function up() {
  const initdb = bin('initdb')
  const pgCtl = bin('pg_ctl')
  const psql = bin('psql')

  mkdirSync(DIR_SOCKET, { recursive: true })
  if (!existsSync(join(DIR_DADOS, 'PG_VERSION'))) {
    console.log(`· initdb em ${DIR_DADOS}`)
    execFileSync(initdb, ['-D', DIR_DADOS, '-U', 'postgres', '--auth=trust', '-E', 'UTF8'], { stdio: 'ignore' })
  }

  const jaRodando = spawnSync(pgCtl, ['-D', DIR_DADOS, 'status'], { stdio: 'ignore' }).status === 0
  if (!jaRodando) {
    console.log(`· subindo PostgreSQL na porta ${PORTA}`)
    execFileSync(
      pgCtl,
      ['-D', DIR_DADOS, '-o', `-p ${PORTA} -k ${DIR_SOCKET} -c listen_addresses=127.0.0.1`, '-l', join(DIR_DADOS, 'server.log'), 'start'],
      { stdio: 'inherit' },
    )
    // pg_ctl start já espera o servidor aceitar conexões.
  } else {
    console.log('· PostgreSQL já está rodando')
  }

  const existe = execFileSync(
    psql,
    ['-h', '127.0.0.1', '-p', PORTA, '-U', 'postgres', '-tAc', `SELECT 1 FROM pg_database WHERE datname='${BANCO}'`],
    { encoding: 'utf8' },
  ).trim()
  if (existe !== '1') {
    console.log(`· criando banco ${BANCO}`)
    execFileSync(psql, ['-h', '127.0.0.1', '-p', PORTA, '-U', 'postgres', '-c', `CREATE DATABASE ${BANCO}`], { stdio: 'inherit' })
  }

  console.log('· aplicando schema (prisma db push)')
  rodar('npx', ['prisma', 'db', 'push', '--skip-generate', '--accept-data-loss'], {
    PRISMA_DATABASE_URL: URL,
    DIRECT_DATABASE_URL: URL,
  })
  console.log(`\n✅ banco de teste pronto: ${URL}\n`)
}

function down() {
  const pgCtl = bin('pg_ctl')
  const r = spawnSync(pgCtl, ['-D', DIR_DADOS, '-m', 'fast', 'stop'], { stdio: 'inherit' })
  console.log(r.status === 0 ? '\n✅ banco de teste parado\n' : '\nℹ️  banco já estava parado\n')
}

function runE2e() {
  rodar('npx', ['tsx', 'scripts/mrg-e2e.test.ts'], { PRISMA_DATABASE_URL: URL, DIRECT_DATABASE_URL: URL })
}

/**
 * Prova, contra banco real, que a migration do MRG é ADITIVA e IDEMPOTENTE:
 * cria um banco limpo com o schema ANTERIOR ao MRG é impossível aqui (o schema
 * atual já o inclui), então a prova feita é a que importa em produção:
 *   1. aplica a migration duas vezes seguidas — a segunda não pode falhar;
 *   2. compara o banco com o datamodel — não pode haver drift.
 */
function migration() {
  const psql = bin('psql')
  const arquivo = 'prisma/migrations/20260830100000_mrg_motor_registral_genealogico/migration.sql'
  for (const passada of [1, 2]) {
    console.log(`· aplicando a migration (passada ${passada}/2)`)
    execFileSync(psql, ['-h', '127.0.0.1', '-p', PORTA, '-U', 'postgres', '-d', BANCO, '-v', 'ON_ERROR_STOP=1', '-q', '-f', arquivo], {
      stdio: 'inherit',
    })
  }
  console.log('· conferindo drift (migration ≡ schema.prisma)')
  rodar('npx', ['prisma', 'migrate', 'diff', '--from-url', URL, '--to-schema-datamodel', 'prisma/schema.prisma', '--exit-code'], {
    PRISMA_DATABASE_URL: URL,
    DIRECT_DATABASE_URL: URL,
  })
  console.log('\n✅ migration aditiva, idempotente e sem drift\n')
}

switch (ACAO) {
  case 'up':
    up()
    break
  case 'down':
    down()
    break
  case 'run-e2e':
    runE2e()
    break
  case 'migration':
    migration()
    break
  default:
    console.error('Uso: node scripts/mrg-banco-teste.mjs [up|down|run-e2e|migration]')
    process.exit(1)
}
