#!/usr/bin/env node
// scripts/backup-producao.mjs
// ============================================================================
// BACKUP DO BANCO DE PRODUÇÃO — SÓ LEITURA, FORA DO REPOSITÓRIO.
//
// O que faz: `pg_dump` em formato custom para ~/Backups-Discovery/producao-AAAAMMDD-HHMMSS.dump,
// depois confere que o arquivo abre com `pg_restore --list` e grava o sha256 ao lado.
// Só LÊ o banco: `pg_dump` roda numa transação de leitura com snapshot consistente, e a
// única outra consulta é `SHOW server_version_num` / `current_database()`.
//
// COMO USAR (a URL só existe na variável do SEU terminal, nunca em argumento nem em arquivo):
//   read -s BACKUP_DATABASE_URL; export BACKUP_DATABASE_URL     # cola a URL DIRETA de produção e Enter
//   node scripts/backup-producao.mjs                             # SIMULAÇÃO: confere tudo, não gera dump
//   node scripts/backup-producao.mjs --executar                  # gera o backup
//   unset BACKUP_DATABASE_URL
//
// TRAVAS (qualquer uma aborta):
//   • URL só pela variável BACKUP_DATABASE_URL (URL em argumento é recusada);
//   • a URL nunca é impressa nem aparece nos argumentos de processo: as credenciais vão ao
//     pg_dump por variáveis de ambiente (PGHOST, PGUSER, PGPASSWORD…), e qualquer texto de
//     erro passa por um filtro que troca URL/senha por «url»/«senha»;
//   • o destino não pode ficar dentro do repositório (vazaria para o git);
//   • o `pg_dump` tem de ser da MESMA versão do servidor ou mais nova;
//   • arquivo criado com permissão 600 e pasta 700.
// Binário: Postgres.app (/Applications/Postgres.app/Contents/Versions/latest/bin) se existir;
// senão o Homebrew mais novo. Para forçar outro: PG_DUMP_BIN=/caminho/pg_dump.
// ============================================================================
import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmodSync, createReadStream, existsSync, mkdirSync, readdirSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const RAIZ = realpathSync(join(dirname(fileURLToPath(import.meta.url)), '..'))
const EXECUTAR = process.argv.includes('--executar')
const URL_BRUTA = process.env.BACKUP_DATABASE_URL ?? ''

function limpar(texto) {
  let t = String(texto)
  if (URL_BRUTA) t = t.split(URL_BRUTA).join('«url»')
  try {
    const senha = decodeURIComponent(new URL(URL_BRUTA).password)
    if (senha) t = t.split(senha).join('«senha»')
  } catch { /* URL inválida: já foi recusada */ }
  return t
}
const abortar = (msg) => { console.error(`⛔ ${limpar(msg)}`); console.error('Nenhum backup foi gerado.'); process.exit(1) }

// ── 1) URL só pela variável ─────────────────────────────────────────────────
if (process.argv.slice(2).some((a) => /^[a-z]+:\/\//i.test(a) || /postgres/i.test(a))) {
  abortar('Não passe a URL como argumento (ela ficaria no histórico do terminal). Use a variável BACKUP_DATABASE_URL.')
}
if (!URL_BRUTA) abortar('Defina BACKUP_DATABASE_URL (use `read -s BACKUP_DATABASE_URL; export BACKUP_DATABASE_URL`).')
let alvo
try { alvo = new URL(URL_BRUTA) } catch { abortar('BACKUP_DATABASE_URL não é uma URL válida.') }
if (!/^postgres(ql)?:$/.test(alvo.protocol)) abortar('A URL precisa ser postgresql://.')
const HOST = alvo.hostname
const PORTA = alvo.port || '5432'
const BANCO = decodeURIComponent(alvo.pathname.replace(/^\//, ''))
if (!BANCO) abortar('A URL não tem nome de banco.')

// ── 2) destino fora do repositório ──────────────────────────────────────────
const DESTINO = resolve(process.env.BACKUP_DESTINO || join(homedir(), 'Backups-Discovery'))
const real = (p) => { try { return realpathSync(p) } catch { return p } }
const destinoReal = existsSync(DESTINO) ? real(DESTINO) : join(real(dirname(DESTINO)), DESTINO.split(sep).pop())
if (destinoReal === RAIZ || destinoReal.startsWith(RAIZ + sep) || destinoReal.startsWith(real(join(RAIZ, '..')) + sep + '.git')) {
  abortar(`O destino (${DESTINO}) está dentro do repositório. Recuso: o backup poderia ir para o git.`)
}

// ── 3) binários (Postgres.app primeiro) ─────────────────────────────────────
function versaoDe(bin) {
  try { return Number(/(\d+)(?:\.\d+)?/.exec(execFileSync(bin, ['--version'], { encoding: 'utf8' }).replace('pg_dump (PostgreSQL)', ''))?.[1]) } catch { return 0 }
}
function candidatos() {
  const lista = []
  if (process.env.PG_DUMP_BIN) lista.push(process.env.PG_DUMP_BIN)
  lista.push('/Applications/Postgres.app/Contents/Versions/latest/bin/pg_dump')
  for (const base of ['/opt/homebrew/opt', '/usr/local/opt']) {
    if (!existsSync(base)) continue
    for (const d of readdirSync(base)) if (/^(postgresql@\d+|libpq)$/.test(d)) lista.push(join(base, d, 'bin', 'pg_dump'))
  }
  return lista.filter((b) => existsSync(b)).map((b) => ({ bin: b, versao: versaoDe(b) })).filter((c) => c.versao > 0)
}
const achados = candidatos()
if (achados.length === 0) abortar('Não achei pg_dump (Postgres.app nem Homebrew). Instale o Postgres.app ou `brew install libpq`.')
achados.sort((a, b) => b.versao - a.versao)
const escolhido = process.env.PG_DUMP_BIN ? achados.find((c) => c.bin === process.env.PG_DUMP_BIN) ?? achados[0]
  : (achados.find((c) => c.bin.startsWith('/Applications/Postgres.app')) ?? achados[0])
const PG_DUMP = escolhido.bin
const PG_RESTORE = join(dirname(PG_DUMP), 'pg_restore')
if (!existsSync(PG_RESTORE)) abortar(`pg_restore não está ao lado do pg_dump (${dirname(PG_DUMP)}).`)

// ── 4) leitura do servidor (única consulta, só leitura) ─────────────────────
const ambientePG = {
  ...process.env,
  PGHOST: HOST, PGPORT: PORTA, PGUSER: decodeURIComponent(alvo.username), PGPASSWORD: decodeURIComponent(alvo.password),
  PGDATABASE: BANCO, PGSSLMODE: alvo.searchParams.get('sslmode') || (/^(localhost|127\.0\.0\.1|::1)$/.test(HOST) ? 'disable' : 'require'), PGCONNECT_TIMEOUT: '30',
}
delete ambientePG.BACKUP_DATABASE_URL
let servidor
{
  const c = new pg.Client({ connectionString: URL_BRUTA, connectionTimeoutMillis: 30000, ssl: /localhost|127\.0\.0\.1/.test(HOST) ? false : { rejectUnauthorized: false } })
  try {
    await c.connect()
    const v = (await c.query('SHOW server_version_num')).rows[0].server_version_num
    const t = (await c.query(`SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`)).rows[0].n
    servidor = { major: Math.floor(Number(v) / 10000), tabelas: t }
  } catch (e) { abortar(`Não consegui ler o servidor: ${e.message}`) } finally { await c.end().catch(() => {}) }
}
if (escolhido.versao < servidor.major) {
  abortar(`O pg_dump encontrado é da versão ${escolhido.versao}, mas o servidor é a ${servidor.major}. O pg_dump precisa ser da mesma versão ou mais nova. Instale o Postgres.app ${servidor.major}+ ou \`brew install postgresql@${servidor.major}\`.`)
}

const agora = new Date()
const p2 = (n) => String(n).padStart(2, '0')
const carimbo = `${agora.getFullYear()}${p2(agora.getMonth() + 1)}${p2(agora.getDate())}-${p2(agora.getHours())}${p2(agora.getMinutes())}${p2(agora.getSeconds())}`
const ARQUIVO = join(DESTINO, `producao-${carimbo}.dump`)

console.log(`Alvo: ${HOST}:${PORTA} / banco "${BANCO}" · servidor PostgreSQL ${servidor.major} · ${servidor.tabelas} tabelas no schema public`)
console.log(`pg_dump: ${PG_DUMP} (versão ${escolhido.versao})`)
console.log(`Destino: ${ARQUIVO}`)
console.log(EXECUTAR ? 'Modo: GERAR O BACKUP (--executar)' : 'Modo: SIMULAÇÃO (nenhum dump é gerado)')
if (!EXECUTAR) {
  console.log('\nPlano: pg_dump -Fc (custom, comprimido) → conferir com pg_restore --list → gravar o sha256 ao lado.')
  console.log('Simulação concluída. Para gerar o backup, rode de novo com --executar.')
  process.exit(0)
}

// ── 5) dump ─────────────────────────────────────────────────────────────────
mkdirSync(DESTINO, { recursive: true, mode: 0o700 })
chmodSync(DESTINO, 0o700)
console.log('\n▶ 1/3 pg_dump… (pode levar alguns minutos)')
const dump = spawnSync(PG_DUMP, ['--format=custom', '--no-sync', '--file', ARQUIVO], { env: ambientePG, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
if (dump.status !== 0) {
  rmSync(ARQUIVO, { force: true }) // nunca deixa um arquivo vazio parecendo backup
  abortar(`pg_dump falhou (código ${dump.status}): ${(dump.stderr || '').slice(0, 600)}`)
}
chmodSync(ARQUIVO, 0o600)
const tamanho = statSync(ARQUIVO).size
if (tamanho < 1024) { rmSync(ARQUIVO, { force: true }); abortar(`O arquivo ficou com ${tamanho} bytes — vazio demais, recuso.`) }

console.log('▶ 2/3 conferindo que o arquivo abre (pg_restore --list)…')
const lista = spawnSync(PG_RESTORE, ['--list', ARQUIVO], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })
if (lista.status !== 0) {
  renameSync(ARQUIVO, `${ARQUIVO}.INVALIDO`) // não confie neste arquivo
  abortar(`pg_restore --list falhou (arquivo renomeado para .INVALIDO): ${(lista.stderr || '').slice(0, 400)}`)
}
const entradas = lista.stdout.split('\n').filter((l) => l && !l.startsWith(';')).length
const tabelasNoDump = lista.stdout.split('\n').filter((l) => /\sTABLE\s+public\s/.test(l)).length

console.log('▶ 3/3 sha256…')
const sha = await new Promise((ok, falha) => {
  const h = createHash('sha256'); const s = createReadStream(ARQUIVO)
  s.on('data', (d) => h.update(d)); s.on('end', () => ok(h.digest('hex'))); s.on('error', falha)
})
writeFileSync(`${ARQUIVO}.sha256`, `${sha}  ${ARQUIVO.split(sep).pop()}\n`, { mode: 0o600 })

console.log(`\n✅ Backup gerado: ${ARQUIVO}`)
console.log(`   tamanho: ${(tamanho / 1024 / 1024).toFixed(1)} MB · ${entradas} itens no índice · ${tabelasNoDump} tabelas (public) · servidor tinha ${servidor.tabelas}`)
console.log(`   sha256: ${sha}`)
if (tabelasNoDump !== servidor.tabelas) console.log('   ⚠ o nº de tabelas do dump difere do servidor — confira antes de confiar neste backup.')
