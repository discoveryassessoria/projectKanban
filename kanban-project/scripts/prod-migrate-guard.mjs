// scripts/prod-migrate-guard.mjs
// ============================================================================
// Aplica migrations em PRODUÇÃO a partir do build da Vercel, onde as variáveis
// sensíveis estão disponíveis — sem que ninguém precise ler o segredo.
//
// SEGURANÇA:
//   • usa PRISMA_DATABASE_URL (o banco que o app realmente usa em runtime),
//     não DIRECT_DATABASE_URL — que está obsoleta apontando para o banco legado;
//   • ANTES de qualquer escrita, prova a identidade do banco: precisa ter o
//     schema V2 completo. Se não bater, ABORTA o build (exit 1) e nada é
//     escrito — build que falha não substitui o deployment em produção;
//   • nunca imprime credenciais, só contagens;
//   • só roda quando MIGRATE_ON_BUILD=1 e VERCEL_ENV=production.
// ============================================================================
import { execSync } from 'node:child_process'

const ligado = process.env.MIGRATE_ON_BUILD === '1'
const ehProducao = process.env.VERCEL_ENV === 'production'

if (!ligado) {
  console.log('[migrate-guard] desligado (MIGRATE_ON_BUILD != 1) — seguindo o build.')
  process.exit(0)
}
if (!ehProducao) {
  console.log(`[migrate-guard] VERCEL_ENV=${process.env.VERCEL_ENV ?? '(vazio)'} — só roda em production. Seguindo.`)
  process.exit(0)
}

const url = process.env.PRISMA_DATABASE_URL
if (!url) {
  console.error('[migrate-guard] ABORTADO: PRISMA_DATABASE_URL ausente no ambiente de build.')
  process.exit(1)
}

const { PrismaClient } = await import('@prisma/client')
const prisma = new PrismaClient({ datasources: { db: { url } } })
const q = (s) => prisma.$queryRawUnsafe(s)

try {
  // ── 1. identidade (sem segredos) ──
  let host = '(desconhecido)'
  try { host = new URL(url).host } catch { /* Accelerate tem outro formato */ }
  console.log(`[migrate-guard] host: ${host}`)

  const tabelas = (await q(
    `SELECT count(*)::int n FROM information_schema.tables WHERE table_schema='public'`,
  ))[0].n
  console.log(`[migrate-guard] tabelas no schema public: ${tabelas}`)

  const temTabela = async (t) =>
    (await q(`SELECT to_regclass('public."${t}"')::text AS t`))[0].t != null
  const temColuna = async (t, c) =>
    (await q(
      `SELECT count(*)::int n FROM information_schema.columns WHERE table_name='${t}' AND column_name='${c}'`,
    ))[0].n > 0

  const essenciais = ['Contratante', 'Processo', 'Receita', 'Custo', 'ProdutoFinanceiro', '_prisma_migrations']
  const faltando = []
  for (const t of essenciais) if (!(await temTabela(t))) faltando.push(t)
  console.log(`[migrate-guard] tabelas essenciais ausentes: ${faltando.length ? faltando.join(', ') : 'nenhuma'}`)

  // Marcadores das migrations do cutover V2 em diante — o staging (12/jul) não tem.
  const marcadores = [
    ['Receita', 'chaveIdempotencia'],
    ['Processo', 'codigo'],
    ['Contratante', 'publicCode'],
  ]
  const semMarcador = []
  for (const [t, c] of marcadores) if (!(await temColuna(t, c))) semMarcador.push(`${t}.${c}`)
  console.log(`[migrate-guard] marcadores V2 ausentes: ${semMarcador.length ? semMarcador.join(', ') : 'nenhum'}`)

  for (const [rot, sql] of [
    ['contratantes', `SELECT count(*)::int n FROM "Contratante"`],
    ['processos', `SELECT count(*)::int n FROM "Processo"`],
    ['receitas', `SELECT count(*)::int n FROM "Receita"`],
  ]) {
    try { console.log(`[migrate-guard] ${rot}: ${(await q(sql))[0].n}`) } catch { console.log(`[migrate-guard] ${rot}: n/d`) }
  }

  let aplicadas = 0
  try {
    aplicadas = (await q(`SELECT count(*)::int n FROM _prisma_migrations WHERE finished_at IS NOT NULL`))[0].n
    const ultimas = await q(
      `SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL ORDER BY finished_at DESC LIMIT 3`,
    )
    console.log(`[migrate-guard] migrations aplicadas: ${aplicadas}`)
    for (const m of ultimas) console.log(`[migrate-guard]   última: ${m.migration_name}`)
  } catch {
    console.log('[migrate-guard] migrations: tabela ausente')
  }

  // ── 2. veredito ──
  const ehProducaoReal = faltando.length === 0 && semMarcador.length === 0 && tabelas >= 100 && aplicadas >= 40
  if (!ehProducaoReal) {
    console.error('[migrate-guard] ABORTADO: o banco apontado por PRISMA_DATABASE_URL NÃO tem a assinatura de produção.')
    console.error('[migrate-guard] Nenhuma escrita foi feita. O deployment atual segue no ar.')
    process.exit(1)
  }
  console.log('[migrate-guard] identidade CONFIRMADA — aplicando migrations.')

  // ── 3. migrate deploy contra o MESMO banco ──
  // directUrl é forçada para a URL de runtime: a DIRECT_DATABASE_URL do projeto
  // está obsoleta (aponta para o banco legado de maio).
  execSync('npx prisma migrate deploy', {
    stdio: 'inherit',
    env: { ...process.env, DIRECT_DATABASE_URL: url },
  })

  const depois = (await q(`SELECT count(*)::int n FROM _prisma_migrations WHERE finished_at IS NOT NULL`))[0].n
  const temColunaNova = await temColuna('ProdutoFinanceiro', 'condicaoPagamentoId')
  console.log(`[migrate-guard] migrations após: ${depois} (antes: ${aplicadas})`)
  console.log(`[migrate-guard] ProdutoFinanceiro.condicaoPagamentoId: ${temColunaNova ? 'PRESENTE' : 'AUSENTE'}`)
  if (!temColunaNova) {
    console.error('[migrate-guard] ABORTADO: a migration não criou a coluna esperada.')
    process.exit(1)
  }
  console.log('[migrate-guard] OK.')
} catch (err) {
  console.error('[migrate-guard] ERRO:', String(err?.message ?? err).slice(0, 300))
  process.exit(1)
} finally {
  await prisma.$disconnect()
}
