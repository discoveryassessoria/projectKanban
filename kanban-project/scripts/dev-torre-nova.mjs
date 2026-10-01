#!/usr/bin/env node
// scripts/dev-torre-nova.mjs
// ============================================================================
// EXECUTOR LOCAL DO PALCO DA NOVA TORRE (branch `torre-nova`).
//
//   node scripts/dev-torre-nova.mjs                 sobe tudo e fica vivo até Ctrl+C
//   node scripts/dev-torre-nova.mjs --porta 3111    porta do next dev (padrão 3111)
//   node scripts/dev-torre-nova.mjs --so-banco      só Postgres efêmero + migrations + seed (sem next dev)
//   node scripts/dev-torre-nova.mjs --pg-porta N    porta do Postgres efêmero (padrão 55433)
//   node scripts/dev-torre-nova.mjs --token         imprime um JWT admin NOVO da instância viva (e atualiza o JSON)
//   node scripts/dev-torre-nova.mjs --forcar        ignora instância viva e sobe outra
//
// O QUE FAZ
//   1. Se já existe uma instância viva (arquivo /private/tmp/claude-501/torre-nova-dev.json com a
//      porta respondendo), REUTILIZA: imprime a URL e sai. Vários implementadores compartilham UMA.
//   2. Senão: Postgres efêmero (embedded-postgres) -> banco `discovery_test_torre_nova` montado com as
//      MESMAS migrations de produção (scripts/ci/criar-banco-de-teste.mjs; inclui as da Etapa A) ->
//      seed scripts/palco-torre-nova.ts -> `next dev` na porta fixa. Grava o JSON e fica vivo.
//
// SEGURANÇA
//   Nunca lê nem escreve .env. O ambiente do filho é MONTADO aqui (lista fechada): URLs do banco
//   efêmero (host 127.0.0.1, nome contendo "test"), JWT_SECRET de teste, R2 falso. O JWT admin é
//   assinado com o segredo de teste — válido SÓ contra este banco local. Produção jamais é tocada.
// ============================================================================
import { spawn, execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { connect } from 'node:net'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { SignJWT } from 'jose'

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..')
const ARQUIVO = '/private/tmp/claude-501/torre-nova-dev.json'
const BANCO = 'discovery_test_torre_nova'
const JWT_SECRET = 'torre-nova-palco-local-NAO-USAR-EM-PRODUCAO-0123456789'

const tem = (n) => process.argv.includes(`--${n}`)
const arg = (n, padrao) => { const i = process.argv.indexOf(`--${n}`); return i > -1 ? process.argv[i + 1] : padrao }
const PORTA = Number(arg('porta', '3111'))
const PORTA_PG = Number(arg('pg-porta', '55433'))

const portaViva = (porta) => new Promise((resolve) => {
  const s = connect({ port: porta, host: '127.0.0.1' })
  s.once('connect', () => { s.destroy(); resolve(true) })
  s.once('error', () => resolve(false))
  setTimeout(() => { s.destroy(); resolve(false) }, 1500)
})

const lerArquivo = () => { try { return JSON.parse(readFileSync(ARQUIVO, 'utf8')) } catch { return null } }

/** JWT admin do banco efêmero. Mesmo formato de lib/auth-jwt (HS256, userId/email/tipo/sessaoInicio). Validade 7 dias (só local). */
async function assinarAdmin(admin) {
  const agora = Date.now()
  return await new SignJWT({ userId: admin.id, email: admin.email, tipo: 'admin', sessaoInicio: agora })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(Math.floor((agora + 7 * 24 * 3600 * 1000) / 1000))
    .sign(new TextEncoder().encode(JWT_SECRET))
}

async function adminDoBanco(urlBanco) {
  const pg = (await import('pg')).default
  const c = new pg.Client({ connectionString: urlBanco }); await c.connect()
  try {
    const r = await c.query(`SELECT id, nome, email, tipo FROM "Usuario" WHERE tipo='admin' ORDER BY id LIMIT 1`)
    if (!r.rows[0]) throw new Error('banco sem usuário admin — o seed não rodou?')
    return r.rows[0]
  } finally { await c.end() }
}

// ── --token: renova o token da instância viva ───────────────────────────────
if (tem('token')) {
  const atual = lerArquivo()
  if (!atual || !(await portaViva(atual.pgPorta))) { console.error('Nenhuma instância viva (rode o executor sem --token primeiro).'); process.exit(1) }
  const admin = await adminDoBanco(atual.urlBanco)
  atual.tokenAdmin = await assinarAdmin(admin)
  writeFileSync(ARQUIVO, JSON.stringify(atual, null, 2))
  console.log(atual.tokenAdmin)
  process.exit(0)
}

// ── reutilizar instância viva ───────────────────────────────────────────────
const existente = lerArquivo()
if (!tem('forcar') && existente && (await portaViva(existente.pgPorta)) && (tem('so-banco') || (existente.porta && (await portaViva(existente.porta))))) {
  console.log(`Instância JÁ VIVA — reutilize, não suba outra.\n  URL     : http://localhost:${existente.porta}/torre?aba=visao\n  banco   : ${existente.urlBanco}\n  detalhes: ${ARQUIVO}`)
  process.exit(0)
}

// ── sobe Postgres efêmero + banco + seed ────────────────────────────────────
const { subirPostgresEfemero } = await import(join(RAIZ, 'scripts/ci/postgres-efemero.mjs'))
console.log(`▶ Postgres efêmero na porta ${PORTA_PG}…`)
const pg = await subirPostgresEfemero({ porta: PORTA_PG })
const urlBanco = `postgresql://postgres@127.0.0.1:${PORTA_PG}/${BANCO}`

const envBase = {
  PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR, LANG: process.env.LANG,
  PRISMA_DATABASE_URL: urlBanco, DIRECT_DATABASE_URL: urlBanco, DATABASE_URL: urlBanco,
  JWT_SECRET, APP_JWT_SECRET: JWT_SECRET, ADMIN_SEED_PASSWORD: 'palco-senha-local-123',
  R2_ACCOUNT_ID: 'x', R2_ACCESS_KEY_ID: 'x', R2_SECRET_ACCESS_KEY: 'x', R2_BUCKET_NAME: 'x', R2_PUBLIC_URL: 'https://x.invalid',
  NEXT_TELEMETRY_DISABLED: '1',
  // `next dev` SEMPRE lê .env/.env.local (não há como impedir) e variável já definida aqui NÃO é sobrescrita pelo arquivo.
  // Por isso as chaves de serviços externos que o código conhece ficam EXPLICITAMENTE vazias/de teste: o palco nunca
  // chama IA, OCR, câmbio, registro civil, e-mail, WhatsApp ou storage de verdade.
  ...Object.fromEntries(['ANTHROPIC_API_KEY', 'OCR_API_KEY', 'CONFIDENCE_API_KEY', 'REGISTRO_CIVIL_API_KEY', 'IMPORT_FAMILIAS_ES_TOKEN',
    'RESEND_API_KEY', 'SENDGRID_API_KEY', 'SMTP_HOST', 'SMTP_USER', 'SMTP_PASSWORD', 'TWILIO_AUTH_TOKEN', 'WHATSAPP_TOKEN', 'BLOB_READ_WRITE_TOKEN',
    'PRISMA_DATABASE_URL_RAW', 'DIRECT_DATABASE_URL_RAW', 'POSTGRES_URL', 'POSTGRES_PRISMA_URL', 'POSTGRES_URL_NON_POOLING'].map((k) => [k, ''])),
  CRON_SECRET: 'torre-nova-palco-cron-local',
  ...(process.env.PALCO_AGORA ? { PALCO_AGORA: process.env.PALCO_AGORA } : {}),
}

let web = null
const sair = (codigo = 0) => {
  try { web?.kill('SIGTERM') } catch { /* já morto */ }
  pg.parar()
  try { if (lerArquivo()?.pidExecutor === process.pid) rmSync(ARQUIVO, { force: true }) } catch { /* ignora */ }
  process.exit(codigo)
}
process.on('SIGINT', () => sair(0)); process.on('SIGTERM', () => sair(0))

try {
  console.log(`▶ Montando ${BANCO} com as migrations reais (≈1–2 min)…`)
  execFileSync('node', [join(RAIZ, 'scripts/ci/criar-banco-de-teste.mjs'), '--banco', BANCO, '--porta', String(PORTA_PG), '--host', '127.0.0.1', '--usuario', 'postgres'], { stdio: 'inherit', cwd: RAIZ })
  console.log('▶ Rodando o seed do palco (scripts/palco-torre-nova.ts)…')
  execFileSync(join(RAIZ, 'node_modules/.bin/tsx'), [join(RAIZ, 'scripts/palco-torre-nova.ts')], { stdio: 'inherit', cwd: RAIZ, env: { ...envBase, NODE_ENV: 'test', CI: '1' } })
} catch (e) {
  console.error('⛔ Falha ao preparar o banco/seed:', e.message); sair(1)
}

const admin = await adminDoBanco(urlBanco)
const tokenAdmin = await assinarAdmin(admin)
mkdirSync(dirname(ARQUIVO), { recursive: true })
const gravar = (extra = {}) => writeFileSync(ARQUIVO, JSON.stringify({
  porta: tem('so-banco') ? null : PORTA, pgPorta: PORTA_PG, urlBanco, tokenAdmin,
  usuarioAdmin: { id: admin.id, nome: admin.nome, email: admin.email, tipo: 'admin' },
  jwtSecretDeTeste: JWT_SECRET, pidExecutor: process.pid, iniciadoEm: new Date().toISOString(), ...extra,
}, null, 2))

if (tem('so-banco')) {
  gravar()
  console.log(`\n✅ Banco pronto (vivo enquanto este processo viver — Ctrl+C encerra e DESCARTA tudo)\n  ${urlBanco}\n  detalhes: ${ARQUIVO}`)
  setInterval(() => {}, 1 << 30)
} else {
  console.log(`▶ next dev na porta ${PORTA}…`)
  web = spawn(join(RAIZ, 'node_modules/.bin/next'), ['dev', '-p', String(PORTA)], { cwd: RAIZ, env: { ...envBase, NODE_ENV: 'development' }, stdio: ['ignore', 'inherit', 'inherit'] })
  web.on('exit', (c) => { console.error(`next dev encerrou (${c}).`); sair(1) })
  // espera responder de verdade (a 1ª compilação da /torre é lenta; aquece login e /torre)
  const limite = Date.now() + 5 * 60 * 1000
  for (;;) {
    if (Date.now() > limite) { console.error('⛔ next dev não respondeu em 5 min.'); sair(1) }
    try { const r = await fetch(`http://127.0.0.1:${PORTA}/login`, { redirect: 'manual' }); if (r.status < 500) break } catch { /* ainda subindo */ }
    await new Promise((r) => setTimeout(r, 1500))
  }
  gravar()
  console.log(`\n✅ PALCO NO AR — Ctrl+C encerra e DESCARTA o banco.\n  URL     : http://localhost:${PORTA}/torre?aba=visao\n  banco   : ${urlBanco}\n  detalhes: ${ARQUIVO}  (porta, urlBanco, tokenAdmin, usuarioAdmin)`)
  // aquece as rotas pesadas (compilação sob demanda do dev) sem bloquear
  for (const rota of ['/torre', '/torre?aba=tarefas']) fetch(`http://127.0.0.1:${PORTA}${rota}`, { redirect: 'manual' }).catch(() => {})
}
