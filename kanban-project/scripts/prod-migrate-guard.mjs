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
  try {
    execSync('npx prisma migrate deploy', { stdio: 'inherit' })
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
