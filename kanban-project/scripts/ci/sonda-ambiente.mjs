// SONDA TEMPORÁRIA (branch ci/sonda-ambiente) — descobre o que o build da Vercel oferece.
import { execSync } from 'node:child_process'
const sh = (c) => { try { return execSync(c, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim() } catch (e) { return `ERRO: ${(e.stderr || e.message).toString().trim().slice(0, 300)}` } }
console.log('=== SONDA DO AMBIENTE DE BUILD ===')
for (const c of ['id', 'uname -a', 'nproc', 'free -m | head -2', 'node -v', 'df -h /tmp | tail -1', 'which postgres psql pg_ctl initdb docker || true', 'cat /etc/os-release | head -3', 'echo VERCEL=$VERCEL VERCEL_ENV=$VERCEL_ENV VERCEL_GIT_COMMIT_SHA=$VERCEL_GIT_COMMIT_SHA']) console.log(`$ ${c}\n${sh(c)}\n`)
console.log('=== embedded-postgres ===')
console.log(sh('npm ls embedded-postgres 2>&1 | head -5'))
try {
  const { default: EmbeddedPostgres } = await import('embedded-postgres')
  const pg = new EmbeddedPostgres({ databaseDir: '/tmp/pgdata-sonda', user: 'postgres', password: 'x', port: 55433, persistent: false })
  await pg.initialise(); await pg.start()
  await pg.createDatabase('sonda')
  const c = pg.getPgClient('sonda'); await c.connect()
  console.log('SELECT version():', (await c.query('select version()')).rows[0].version)
  await c.end(); await pg.stop()
  console.log('✅ POSTGRES REAL SOBE NO BUILD')
} catch (e) { console.log('❌ embedded-postgres falhou:', String(e).slice(0, 600)) }
process.exit(1) // a sonda nunca deixa o build passar
