// SONDA TEMPORÁRIA (branch ci/sonda-ambiente) — sobe Postgres real no build da Vercel, à mão.
import { execSync, spawnSync } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
const sh = (c) => { try { return execSync(c, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim() } catch (e) { return `ERRO: ${(e.stderr || e.message).toString().trim().slice(0, 400)}` } }
const p = (c) => console.log(`$ ${c}\n${sh(c)}\n`)
console.log('=== SONDA v3 ===')
p('which useradd runuser su setpriv adduser || true')
const nat = 'node_modules/@embedded-postgres/linux-x64/native'
console.log('native existe:', existsSync(nat), existsSync(nat) ? readdirSync(nat).join(',') : '')
p(`ls ${nat}/bin | tr '\\n' ' '`)
p('rm -rf /opt/pgnative && cp -r ' + nat + ' /opt/pgnative && chmod -R a+rX /opt/pgnative && ls /opt/pgnative/bin | tr "\\n" " "')
p('id pgtest || useradd -m pgtest; id pgtest')
p('rm -rf /tmp/pgdata && mkdir -p /tmp/pgdata /tmp/pgsock && chown -R pgtest /tmp/pgdata /tmp/pgsock && chmod 700 /tmp/pgdata')
const uid = Number(sh('id -u pgtest')); const gid = Number(sh('id -g pgtest'))
const run = (cmd, args) => { const r = spawnSync(cmd, args, { uid, gid, encoding: 'utf8', env: { PATH: process.env.PATH, LC_ALL: 'C', LD_LIBRARY_PATH: '/opt/pgnative/lib' } }); return `exit=${r.status}\n${(r.stdout || '').slice(-500)}\n${(r.stderr || '').slice(-700)}` }
console.log('initdb:', run('/opt/pgnative/bin/initdb', ['-D', '/tmp/pgdata', '-U', 'postgres', '--auth=trust', '--encoding=UTF8', '--locale=C']))
console.log('pg_ctl start:', run('/opt/pgnative/bin/pg_ctl', ['-D', '/tmp/pgdata', '-o', '-p 55432 -k /tmp/pgsock -c listen_addresses=127.0.0.1', '-w', '-l', '/tmp/pg.log', 'start']))
const { default: pg } = await import('pg')
try {
  const c = new pg.Client({ host: '127.0.0.1', port: 55432, user: 'postgres', database: 'postgres' }); await c.connect()
  console.log('version:', (await c.query('select version()')).rows[0].version)
  await c.end(); console.log('✅ POSTGRES REAL SOBE NO BUILD DA VERCEL')
} catch (e) { console.log('❌ conexão falhou:', String(e).slice(0, 300)); p('tail -20 /tmp/pg.log') }
run('/opt/pgnative/bin/pg_ctl', ['-D', '/tmp/pgdata', '-m', 'immediate', 'stop'])
process.exit(1)
