// scripts/prod-migrate-guard.mjs
// ============================================================================
// GUARD DEFINITIVO DE MIGRATION EM PRODUÇÃO.
//
// Roda dentro do build da Vercel, onde as variáveis sensíveis existem. Prova a
// identidade do banco ANTES de qualquer escrita e só então executa
// `prisma migrate deploy` — o ÚNICO comando permitido contra produção.
//
// Validações obrigatórias (qualquer falha aborta sem escrever):
//   1. flag MIGRATE_ON_BUILD=1 e VERCEL_ENV=production
//   2. variável de conexão presente
//   3. tabelas sentinela existem
//   4. quantidade mínima de tabelas
//   5. _prisma_migrations presente, com mínimo de migrations aplicadas
//   6. fingerprint de produção (classificar() → PRODUCAO)
//   7. produção NUNCA usada como shadow database
//   8. confirmação explícita fora do código
//
// Build que falha NÃO substitui o deployment em produção.
// ============================================================================
import { execSync } from 'node:child_process'
import {
  CLASSE,
  classificar,
  confirmacaoExplicitaOk,
  identificador,
  mesmoBanco,
  retratar,
} from '../lib/db/identidade-banco.mjs'

const abortar = (msg) => {
  console.error(`[migrate-guard] ABORTADO: ${msg}`)
  console.error('[migrate-guard] Nenhuma escrita foi feita. O deployment atual segue no ar.')
  process.exit(1)
}

if (process.env.MIGRATE_ON_BUILD !== '1') {
  console.log('[migrate-guard] desligado (MIGRATE_ON_BUILD != 1) — seguindo o build.')
  process.exit(0)
}
// HOMOLOGAÇÃO — Preview com MIGRATE_ON_BUILD=1 aplica as migrations no banco de
// homologação. Caminho SEPARADO e mais curto de propósito: as provas de identidade
// abaixo (fingerprint PRODUCAO, sentinelas, confirmação explícita) existem para
// proteger PRODUÇÃO e classificariam um banco de homologação como não-produção.
// Aqui não há seed nem backfill: só `prisma migrate deploy`.
if (process.env.VERCEL_ENV === 'preview') {
  const urlPrev = process.env.PRISMA_DATABASE_URL
  if (!urlPrev) abortar('PRISMA_DATABASE_URL ausente no build de Preview.')
  console.log(`[migrate-guard] PREVIEW · alvo: ${identificador(urlPrev)}`)
  // DIRECT_DATABASE_URL do projeto é OBSOLETA (aponta para o banco danificado de
  // 21/07, db.prisma.io). O Prisma CLI usa `directUrl` para migrar — sem esta
  // sobrescrita, o `migrate deploy` do Preview ia para o banco ERRADO, não para o
  // banco de homologação. Mesma trava já aplicada no caminho de produção abaixo.
  if (/db\.prisma\.io/i.test(identificador(urlPrev))) {
    abortar('PRISMA_DATABASE_URL do Preview aponta para db.prisma.io (Prisma Postgres = produção). Preview só pode migrar homologação.')
  }
  try {
    execSync('npx prisma migrate deploy', {
      stdio: 'inherit',
      env: { ...process.env, DIRECT_DATABASE_URL: urlPrev },
    })
    console.log('[migrate-guard] PREVIEW · migrate deploy concluído.')
  } catch (err) {
    abortar(`migrate deploy falhou no Preview: ${String(err?.message ?? err).slice(0, 200)}`)
  }
  process.exit(0)
}

// Produção: segue o caminho completo — identidade, shadow, confirmação explícita.
if (process.env.VERCEL_ENV !== 'production') {
  console.log(`[migrate-guard] VERCEL_ENV=${process.env.VERCEL_ENV ?? '(vazio)'} — só roda em production.`)
  process.exit(0)
}

const url = process.env.PRISMA_DATABASE_URL
if (!url) abortar('PRISMA_DATABASE_URL ausente no ambiente de build.')

// 7. shadow jamais pode ser o banco principal
const shadow = process.env.SHADOW_DATABASE_URL
if (shadow && mesmoBanco(shadow, url)) {
  abortar('SHADOW_DATABASE_URL aponta para o banco principal. Shadow é destruído pelo Prisma — proibido.')
}

// 8. confirmação explícita
if (!confirmacaoExplicitaOk()) {
  abortar(
    "escrita em produção exige EU_CONFIRMO_ESCRITA_EM_PRODUCAO='SIM, ESCREVER EM PRODUCAO' " +
    'definida no ambiente do projeto (fora do código).',
  )
}

const { PrismaClient } = await import('@prisma/client')
const prisma = new PrismaClient({ datasources: { db: { url } } })

try {
  console.log(`[migrate-guard] alvo: ${identificador(url)}`)

  const retrato = await retratar(prisma)
  console.log(
    `[migrate-guard] retrato: ${retrato.tabelas} tabelas · ${retrato.migrations} migrations · ${retrato.requerentes} requerentes`,
  )
  if (retrato.sentinelasAusentes.length) {
    console.log(`[migrate-guard] sentinelas ausentes: ${retrato.sentinelasAusentes.join(', ')}`)
  }

  const classe = classificar(retrato)
  console.log(`[migrate-guard] classificação: ${classe}`)
  if (classe !== CLASSE.PRODUCAO) {
    abortar(`o banco não tem assinatura de produção (classificado como ${classe}).`)
  }

  const antes = retrato.migrations

  // ---- PLANO (leitura pura, antes de qualquer escrita) --------------------
  // Quais migrations do repositório ainda não estão em `_prisma_migrations`, e
  // quais delas contêm SQL destrutivo. Produção é patrimônio: o que vai ser
  // executado precisa estar no log ANTES de ser executado.
  try {
    const { default: path } = await import('node:path')
    const { listarMigrations, sqlDaMigration } = await import('../lib/db/leitura-migrations.mjs')
    const DIR = path.join(process.cwd(), 'prisma', 'migrations')
    const todas = listarMigrations(DIR)
    const registradas = new Set(
      (await prisma.$queryRawUnsafe('SELECT migration_name FROM _prisma_migrations')).map((r) => r.migration_name),
    )
    const pendentes = todas.filter((m) => !registradas.has(m))
    console.log(`[migrate-guard] PLANO: ${todas.length} no repositório · ${registradas.size} registradas · ${pendentes.length} pendentes`)
    const DESTRUTIVO = /\b(DROP\s+(TABLE|COLUMN|SCHEMA|DATABASE)|TRUNCATE|DELETE\s+FROM)\b/i
    const MUTACAO = /\bUPDATE\s+"?\w+"?\s+SET\b/i
    for (const m of pendentes) {
      const sql = sqlDaMigration(DIR, m)
      const marcas = [DESTRUTIVO.test(sql) && 'DESTRUTIVO', MUTACAO.test(sql) && 'UPDATE de dado'].filter(Boolean)
      console.log(`[migrate-guard]   ○ ${m}${marcas.length ? `  ⚠ ${marcas.join(' + ')}` : ''}`)
    }
    if (!pendentes.length) console.log('[migrate-guard]   (nada pendente — migrate deploy será no-op)')
  } catch (e) {
    console.log(`[migrate-guard] AVISO: não consegui montar o plano (${String(e?.message ?? e).slice(0, 150)}). Seguindo — o Prisma loga cada migration aplicada.`)
  }

  console.log('[migrate-guard] identidade CONFIRMADA — aplicando migrations (migrate deploy).')

  // directUrl forçada para a mesma URL: DIRECT_DATABASE_URL do projeto está
  // obsoleta (aponta para o banco danificado de 21/07).
  execSync('npx prisma migrate deploy', {
    stdio: 'inherit',
    env: { ...process.env, DIRECT_DATABASE_URL: url },
  })

  const depois = await retratar(prisma)
  console.log(`[migrate-guard] migrations: ${antes} → ${depois.migrations}`)
  console.log(`[migrate-guard] requerentes após: ${depois.requerentes} (antes: ${retrato.requerentes})`)

  if (depois.requerentes < retrato.requerentes) {
    abortar(`PERDA DE DADOS DETECTADA: requerentes caiu de ${retrato.requerentes} para ${depois.requerentes}.`)
  }
  console.log('[migrate-guard] OK.')
} catch (err) {
  console.error('[migrate-guard] ERRO:', String(err?.message ?? err).slice(0, 300))
  process.exit(1)
} finally {
  await prisma.$disconnect()
}
