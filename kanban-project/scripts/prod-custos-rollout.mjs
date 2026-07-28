// scripts/prod-custos-rollout.mjs
// ============================================================================
// ROLLOUT DE CUSTOS EM PRODUÇÃO — seed das permissões, validação dos perfis e
// smoke completo, dentro do build (único lugar com PRISMA_DATABASE_URL de prod).
//
// Roda SÓ com:
//   VERCEL_ENV=production
//   PROD_CUSTOS_ROLLOUT=1                       (liga esta etapa)
//   EU_CONFIRMO_ESCRITA_EM_PRODUCAO='SIM, ESCREVER EM PRODUCAO'   (autoriza o seed)
// e só depois de provar que o alvo tem fingerprint de PRODUÇÃO.
//
// Etapas, nesta ordem, parando na primeira falha:
//   1. seed idempotente das 10 chaves `financeiro.custo_*` nos perfis da matriz
//      (nenhuma outra permissão é tocada);
//   2. validação dos perfis contra a matriz, nos dois modos de segregação;
//   3. smoke de produção de Receitas e Custos — SOMENTE LEITURA.
//
// Passe PROD_CUSTOS_ROLLOUT=smoke para repetir só o smoke (2ª passada, depois de
// ligar FINANCEIRO_PERMISSOES_CUSTO_ESTRITAS): sem seed, sem escrita alguma.
// ============================================================================
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { CLASSE, classificar, confirmacaoExplicitaOk, identificador, retratar } from '../lib/db/identidade-banco.mjs'

// Binário local — nada de `npx`, que pode tentar resolver na rede durante o build.
const TSX = path.join(process.cwd(), 'node_modules', '.bin', 'tsx')

const MODO = (process.env.PROD_CUSTOS_ROLLOUT || '').toLowerCase()
const log = (m) => console.log(`[custos-rollout] ${m}`)

if (!MODO) { log('desligado (PROD_CUSTOS_ROLLOUT ausente) — seguindo o build.'); process.exit(0) }
if (!['1', 'completo', 'smoke'].includes(MODO)) {
  console.error(`[custos-rollout] ABORTADO: PROD_CUSTOS_ROLLOUT inválido (${MODO}). Use 1|completo|smoke.`)
  process.exit(1)
}
const soSmoke = MODO === 'smoke'

if (process.env.VERCEL_ENV !== 'production') {
  log(`VERCEL_ENV=${process.env.VERCEL_ENV ?? '(vazio)'} — só roda em production. Pulando.`)
  process.exit(0)
}
const url = process.env.PRISMA_DATABASE_URL
if (!url) { console.error('[custos-rollout] ABORTADO: PRISMA_DATABASE_URL ausente.'); process.exit(1) }
if (!soSmoke && !confirmacaoExplicitaOk()) {
  console.error("[custos-rollout] ABORTADO: o seed exige EU_CONFIRMO_ESCRITA_EM_PRODUCAO='SIM, ESCREVER EM PRODUCAO'.")
  process.exit(1)
}

const { PrismaClient } = await import('@prisma/client')
const prisma = new PrismaClient({ datasources: { db: { url } } })
try {
  const retrato = await retratar(prisma)
  const classe = classificar(retrato)
  log(`alvo: ${identificador(url)} — ${classe} (tabelas=${retrato.tabelas}, migrations=${retrato.migrations}, requerentes=${retrato.requerentes})`)
  if (classe !== CLASSE.PRODUCAO) {
    console.error(`[custos-rollout] ABORTADO: alvo não tem assinatura de PRODUÇÃO (${classe}).`)
    process.exit(1)
  }
  log(`identidade CONFIRMADA · modo: ${soSmoke ? 'SÓ SMOKE (nenhuma escrita)' : 'COMPLETO (seed + validação + smoke)'}`)
} finally {
  await prisma.$disconnect().catch(() => {})
}

const ETAPAS = soSmoke
  ? [['Smoke de produção (Receitas e Custos)', ['scripts/prod-smoke-custos.ts']]]
  : [
      ['Seed das permissões custo_*', ['scripts/seed-permissoes-custo.ts']],
      ['Validação dos perfis', ['scripts/prod-validar-perfis-custo.ts']],
      ['Smoke de produção (Receitas e Custos)', ['scripts/prod-smoke-custos.ts']],
    ]

for (const [rotulo, argv] of ETAPAS) {
  console.log(`\n${'─'.repeat(70)}\n[custos-rollout] ▶ ${rotulo}\n${'─'.repeat(70)}`)
  const r = spawnSync(TSX, argv, { stdio: 'inherit', env: process.env })
  if (r.status !== 0) {
    console.error(`[custos-rollout] ✗ ${rotulo} FALHOU (exit ${r.status}). Build derrubado.`)
    process.exit(1)
  }
  console.log(`[custos-rollout] ✓ ${rotulo} OK.`)
}

console.log(`\n[custos-rollout] ROLLOUT ${soSmoke ? 'SMOKE' : 'COMPLETO'} CONCLUÍDO.`)
