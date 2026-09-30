#!/usr/bin/env node
// scripts/ci/criar-banco-de-teste.mjs
// ============================================================================
// O BANCO DE TESTE COM AS MESMAS MIGRATIONS SQL DE PRODUÇÃO — sem `db push`.
//
//   node scripts/ci/criar-banco-de-teste.mjs [--banco discovery_test_ci] [--porta 55432]
//                                            [--host 127.0.0.1] [--usuario postgres]
//
// POR QUE NÃO `prisma db push`: o `db push` monta o banco a partir do schema.prisma e NÃO
// cria o que só existe nas migrations escritas à mão (índices únicos parciais, CHECKs,
// triggers). O resultado era uma suíte verde contra um banco MAIS PERMISSIVO que produção
// (e ~20 scripts vermelhos "por drift"): a trava que protege produção nunca era tocada.
//
// COMO (o mesmo método que `baseline-integridade-real.test.ts` já prova):
//   1. `baseline.sql` (histórico imutável) como SQL bruto;
//   2. marca o baseline + as migrations ABSORVIDAS por ele como aplicadas (bookkeeping,
//      nunca reexecuta o SQL delas — `prisma/baseline/migrations-absorvidas.json`);
//   3. `prisma migrate deploy` aplica de verdade só as migrations posteriores — o SQL
//      REAL de produção, incluindo os índices parciais;
//   4. prova: zero diferença entre o banco e o schema.prisma;
//   5. fixture mínima (`seed-fixture-minima-teste.ts`): runtime v2 ligado, país/modalidade,
//      admin — dados, nunca schema.
//
// Só recria banco cujo NOME contém "test" e em host de loopback: nunca toca produção.
// ============================================================================
import { execFileSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import pg from 'pg'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const arg = (n, padrao) => { const i = process.argv.indexOf(`--${n}`); return i > -1 ? process.argv[i + 1] : padrao }
const BANCO = arg('banco', 'discovery_test_ci')
const PORTA = arg('porta', process.env.MRG_TEST_PORT || '55432')
const HOST = arg('host', '127.0.0.1')
const USUARIO = arg('usuario', 'postgres')

if (!/test/i.test(BANCO) || !['127.0.0.1', 'localhost'].includes(HOST)) {
  console.error(`⛔ Recuso: só recrio banco LOCAL cujo nome contém "test" (recebi ${HOST}/${BANCO}).`); process.exit(1)
}

const URL = `postgresql://${USUARIO}@${HOST}:${PORTA}/${BANCO}`
const ADMIN = `postgresql://${USUARIO}@${HOST}:${PORTA}/postgres`
const PRISMA = join(RAIZ, 'node_modules', '.bin', 'prisma')
const env = { ...process.env, PRISMA_DATABASE_URL: URL, DIRECT_DATABASE_URL: URL }
const exec = (cmd, args, e = env) => execFileSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: e, cwd: RAIZ })

const manifesto = JSON.parse(readFileSync(join(RAIZ, 'prisma/baseline/migrations-absorvidas.json'), 'utf8'))
const todas = readdirSync(join(RAIZ, 'prisma/migrations'), { withFileTypes: true })
  .filter((d) => d.isDirectory() && d.name !== '0000_baseline').map((d) => d.name).sort()
const novas = todas.filter((n) => !manifesto.migrationsAbsorvidas.includes(n))

console.log(`banco de teste ${BANCO}: baseline + ${manifesto.migrationsAbsorvidas.length} absorvidas (bookkeeping) + ${novas.length} migrations REAIS`)
// Sem `psql` (não existe no build da Vercel): tudo pelo driver `pg`. O baseline é um script de
// vários comandos — o protocolo simples do `pg` o executa inteiro, parando no primeiro erro.
async function sql(url, texto) {
  const c = new pg.Client({ connectionString: url }); await c.connect()
  try { await c.query(texto) } finally { await c.end() }
}
await sql(ADMIN, `DROP DATABASE IF EXISTS "${BANCO}" WITH (FORCE)`)
await sql(ADMIN, `CREATE DATABASE "${BANCO}"`)
await sql(URL, readFileSync(join(RAIZ, 'prisma/baseline/baseline.sql'), 'utf8'))
// Bookkeeping das migrations absorvidas. `migrate resolve` faz UMA por processo (~0,6s cada, ~40s
// no total); o primeiro chamado cria a tabela `_prisma_migrations`, o resto entra por SQL com o
// MESMO checksum que o Prisma calcula (sha256 do migration.sql) — o resultado é idêntico.
exec(PRISMA, ['migrate', 'resolve', '--applied', '0000_baseline'])
{
  const c = new pg.Client({ connectionString: URL }); await c.connect()
  try {
    for (const nome of manifesto.migrationsAbsorvidas) {
      const arquivo = join(RAIZ, 'prisma/migrations', nome, 'migration.sql')
      const checksum = createHash('sha256').update(readFileSync(arquivo)).digest('hex')
      await c.query(
        `INSERT INTO "_prisma_migrations" (id, checksum, finished_at, migration_name, logs, started_at, applied_steps_count)
         VALUES ($1, $2, now(), $3, NULL, now(), 0)`, [randomUUID(), checksum, nome])
    }
  } finally { await c.end() }
}
exec(PRISMA, ['migrate', 'deploy'])

const diff = exec(PRISMA, ['migrate', 'diff', '--from-url', URL, '--to-schema-datamodel', join(RAIZ, 'prisma/schema.prisma'), '--script'])
if (diff.trim() !== '-- This is an empty migration.') {
  console.error('⛔ O banco montado pelas migrations DIVERGE do schema.prisma:\n' + diff.slice(0, 800)); process.exit(1)
}
console.log('✅ zero diferença contra schema.prisma (migrations de produção reproduzem o schema)')

const tsx = join(RAIZ, 'node_modules', '.bin', 'tsx')
// Dados de REFERÊNCIA que produção tem e o schema não carrega: o Catálogo de Fases (competência de
// efeitos por fase). Vem de uma FOTOGRAFIA versionada de produção (`fixtures/catalogo-fase.json`,
// gerada por `capturar-referencia-producao.ts`) — o gate NUNCA lê produção. Sem isto, a publicação
// de workflow recusa efeitos por "fora de competência" e dezenas de testes falham por dado ausente.
console.log(exec(tsx, ['scripts/ci/carregar-referencia.ts']).trim())
console.log(exec(tsx, ['scripts/seed-fixture-minima-teste.ts']).trim())
console.log(`\n✅ banco de teste pronto: ${URL}`)
