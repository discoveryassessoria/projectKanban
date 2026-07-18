// scripts/guard-nonprod-db.ts
// ============================================================================
// §14 — GUARD DE SEGURANÇA: impede migrations/backfills/build contra o banco de
// PRODUÇÃO. Rode ANTES de qualquer operação que toque o banco em ambiente de
// teste/preview. Aborta (exit 1) se o host do banco for o de produção OU se o
// ambiente não estiver explicitamente marcado como não-produção.
//
// Uso: DB_ENV=preview PROD_DB_HOST=<host-de-prod> npx tsx scripts/guard-nonprod-db.ts
//   (encadeie: npm run guard:db && prisma migrate deploy)
//
// Convenções:
//   • DB_ENV deve ser "test" ou "preview" (nunca "production").
//   • PROD_DB_HOST = host do banco de produção (para bloquear por igualdade).
//   • Lê o host de PRISMA_DATABASE_URL || DATABASE_URL || DIRECT_DATABASE_URL.
// ============================================================================
function partesDe(url: string | undefined): { host: string; hostname: string } | null {
  if (!url) return null
  try { const u = new URL(url); return { host: u.host, hostname: u.hostname } } catch { return null }
}

const dbEnv = (process.env.DB_ENV || '').toLowerCase()
const prodHost = (process.env.PROD_DB_HOST || '').toLowerCase()
const efetivo = process.env.PRISMA_DATABASE_URL || process.env.DATABASE_URL || process.env.DIRECT_DATABASE_URL
const partes = partesDe(efetivo)
const host = (partes?.host || '').toLowerCase()
const hostname = (partes?.hostname || '').toLowerCase()

console.log(`[guard] DB_ENV=${dbEnv || '(vazio)'} · host=${host || '(vazio)'}`)

if (!dbEnv || dbEnv === 'production' || dbEnv === 'prod') {
  console.error('[guard] ABORTADO: defina DB_ENV=test|preview explicitamente (nunca production).')
  process.exit(1)
}
// bloqueia por igualdade de host OU hostname (porta-insensível) contra o prod conhecido.
if (prodHost && (host === prodHost || hostname === prodHost || host.startsWith(prodHost + ':'))) {
  console.error(`[guard] ABORTADO: o host do banco (${host}) é o de PRODUÇÃO. Aponte para test/preview.`)
  process.exit(1)
}
if (!host) {
  console.error('[guard] ABORTADO: não foi possível determinar o host do banco (defina a URL de teste/preview).')
  process.exit(1)
}
console.log('[guard] OK — ambiente NÃO-produção liberado para migrations/backfills/build.')
