// scripts/prod-registral-rollout.mjs
// ============================================================================
// ROLLOUT DO MOTOR REGISTRAL EM PRODUÇÃO — seed das permissões e smoke, dentro do
// build (único lugar onde PRISMA_DATABASE_URL de produção existe).
//
// Roda SÓ com:
//   VERCEL_ENV=production
//   PROD_REGISTRAL_ROLLOUT=1|completo|smoke        (liga esta etapa)
//   EU_CONFIRMO_ESCRITA_EM_PRODUCAO='SIM, ESCREVER EM PRODUCAO'   (autoriza o seed)
// e só depois de provar que o alvo tem fingerprint de PRODUÇÃO.
//
// Etapas, parando na primeira falha:
//   1. seed idempotente das 8 chaves `registral.*` nos perfis da matriz
//      (nenhuma outra permissão é tocada; `mesclar_pessoas` fica FALSA — OPT-IN);
//   2. smoke de produção do motor — SOMENTE LEITURA.
//
// Passe PROD_REGISTRAL_ROLLOUT=smoke para repetir só o smoke: sem seed, sem
// escrita alguma. É o valor que deve ficar permanente depois do rollout.
//
// Build que falha NÃO substitui o deployment em produção.
// ============================================================================
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { CLASSE, classificar, confirmacaoExplicitaOk, identificador, retratar } from '../lib/db/identidade-banco.mjs'

// Binário local — nada de `npx`, que pode tentar resolver na rede durante o build.
const TSX = path.join(process.cwd(), 'node_modules', '.bin', 'tsx')

const MODO = (process.env.PROD_REGISTRAL_ROLLOUT || '').toLowerCase()
const log = (m) => console.log(`[registral-rollout] ${m}`)

if (!MODO) {
  log('desligado (PROD_REGISTRAL_ROLLOUT ausente) — seguindo o build.')
  process.exit(0)
}
if (!['1', 'completo', 'smoke'].includes(MODO)) {
  console.error(`[registral-rollout] ABORTADO: PROD_REGISTRAL_ROLLOUT inválido (${MODO}). Use 1|completo|smoke.`)
  process.exit(1)
}
const soSmoke = MODO === 'smoke'

if (process.env.VERCEL_ENV !== 'production') {
  log(`VERCEL_ENV=${process.env.VERCEL_ENV ?? '(vazio)'} — só roda em production. Pulando.`)
  process.exit(0)
}

const url = process.env.PRISMA_DATABASE_URL
if (!url) {
  console.error('[registral-rollout] ABORTADO: PRISMA_DATABASE_URL ausente.')
  process.exit(1)
}
if (!soSmoke && !confirmacaoExplicitaOk()) {
  console.error(
    "[registral-rollout] ABORTADO: o seed exige EU_CONFIRMO_ESCRITA_EM_PRODUCAO='SIM, ESCREVER EM PRODUCAO'.",
  )
  process.exit(1)
}

const { PrismaClient } = await import('@prisma/client')
const prisma = new PrismaClient({ datasources: { db: { url } } })
try {
  const retrato = await retratar(prisma)
  const classe = classificar(retrato)
  log(
    `alvo: ${identificador(url)} — ${classe} (tabelas=${retrato.tabelas}, migrations=${retrato.migrations}, requerentes=${retrato.requerentes})`,
  )
  if (classe !== CLASSE.PRODUCAO) {
    console.error(`[registral-rollout] ABORTADO: alvo não tem assinatura de PRODUÇÃO (${classe}).`)
    process.exit(1)
  }
  log(`identidade CONFIRMADA · modo: ${soSmoke ? 'SÓ SMOKE (nenhuma escrita)' : 'COMPLETO (seed + smoke)'}`)
} finally {
  await prisma.$disconnect().catch(() => {})
}

const ETAPAS = soSmoke
  ? [['Smoke de produção do motor registral', ['scripts/prod-smoke-registral.ts']]]
  : [
      ['Seed das permissões registral_*', ['scripts/seed-permissoes-registral.ts']],
      ['Smoke de produção do motor registral', ['scripts/prod-smoke-registral.ts']],
    ]

for (const [rotulo, argv] of ETAPAS) {
  console.log(`\n${'─'.repeat(70)}\n[registral-rollout] ▶ ${rotulo}\n${'─'.repeat(70)}`)
  const r = spawnSync(TSX, argv, { stdio: 'inherit', env: process.env })
  if (r.status !== 0) {
    console.error(`[registral-rollout] ✗ ${rotulo} FALHOU (exit ${r.status}). Build derrubado.`)
    process.exit(1)
  }
  console.log(`[registral-rollout] ✓ ${rotulo} OK.`)
}

console.log(`\n[registral-rollout] ROLLOUT ${soSmoke ? 'SMOKE' : 'COMPLETO'} CONCLUÍDO.`)
