// scripts/migration-pendente-guard.mjs
// ============================================================================
// CÓDIGO NOVO NÃO SOBE ANTES DO SCHEMA QUE ELE PRECISA.
//
// Roda no BUILD, antes do `next build`. Se o repositório tem migration que o banco
// alvo ainda não aplicou, o build FALHA — e o deployment anterior continua no ar,
// intacto.
//
// ─── POR QUE ISTO EXISTE ────────────────────────────────────────────────────
// Em 19/08 uma migration aditiva foi commitada e o deploy subiu sem aplicá-la: o
// `prod-migrate-guard.mjs` existe, mas só estava ligado num script alternativo
// (`build:prod-migrate`) que a Vercel não usa. Setar `MIGRATE_ON_BUILD=1` não teve
// efeito nenhum, e por alguns minutos o código novo consultou colunas que o banco
// ainda não tinha. Ninguém tinha errado o procedimento — o procedimento não estava
// ligado no lugar por onde o deploy passa.
//
// A proteção não pode depender de alguém lembrar. Por isso ela é uma PERGUNTA feita
// em todo build: "o banco alvo tem tudo o que este código pressupõe?".
//
// ─── O QUE ELE NÃO FAZ ──────────────────────────────────────────────────────
// Não aplica migration. Não escreve nada, em banco nenhum. Aplicar continua sendo
// ato explícito do `prod-migrate-guard.mjs`, com as travas dele (identidade do
// banco, sentinelas, confirmação nominal). Este guard só recusa deixar passar.
//
// ─── ONDE ELE VALE ──────────────────────────────────────────────────────────
// Só quando há deploy de verdade (`VERCEL_ENV` = production ou preview). Em
// máquina de desenvolvimento o banco costuma vir de `db push` — que nem escreve o
// ledger —, e reprovar ali seria ruído diário sem proteger nada.
// ============================================================================
import path from 'node:path'
import { listarMigrations } from '../lib/db/leitura-migrations.mjs'

const AMBIENTE = process.env.VERCEL_ENV ?? ''
const ehDeploy = AMBIENTE === 'production' || AMBIENTE === 'preview'

if (!ehDeploy) {
  console.log('[migration-guard] fora de deploy (VERCEL_ENV vazio) — pulando a verificação de pendências.')
  process.exit(0)
}

const url = process.env.PRISMA_DATABASE_URL ?? process.env.DATABASE_URL
if (!url) {
  console.error('[migration-guard] ABORTADO: sem PRISMA_DATABASE_URL/DATABASE_URL para verificar o schema do alvo.')
  process.exit(1)
}

const { PrismaClient } = await import('@prisma/client')
const prisma = new PrismaClient({ datasources: { db: { url } } })

try {
  const DIR = path.join(process.cwd(), 'prisma', 'migrations')
  const todas = listarMigrations(DIR)

  const registradas = new Set(
    (await prisma.$queryRawUnsafe('SELECT migration_name FROM _prisma_migrations')).map((r) => r.migration_name),
  )
  const pendentes = todas.filter((m) => !registradas.has(m))

  console.log(
    `[migration-guard] ${AMBIENTE} · ${todas.length} migration(s) no repositório · ` +
    `${registradas.size} aplicada(s) no alvo · ${pendentes.length} pendente(s)`,
  )

  if (pendentes.length === 0) {
    console.log('[migration-guard] schema do alvo em dia com o repositório — seguindo o build.')
    process.exit(0)
  }

  // COM a confirmação explícita, quem aplica é o `prod-migrate-guard.mjs`, que roda
  // logo em seguida no mesmo build. Aqui a pendência é esperada: não reprova.
  if (process.env.MIGRATE_ON_BUILD === '1') {
    console.log(
      `[migration-guard] ${pendentes.length} pendente(s), e MIGRATE_ON_BUILD=1: ` +
      `a aplicação é feita pelo prod-migrate-guard, com as travas dele. Seguindo.`,
    )
    process.exit(0)
  }

  console.error('')
  console.error('  MIGRATION PENDENTE — O BUILD PARA AQUI, DE PROPÓSITO')
  console.error('')
  console.error(`  O código deste commit pressupõe ${pendentes.length} migration(s) que o banco alvo`)
  console.error('  ainda não tem:')
  for (const m of pendentes) console.error(`    · ${m}`)
  console.error('')
  console.error('  Deixar passar significa subir código que consulta coluna inexistente.')
  console.error('  O deployment atual continua no ar — nada foi alterado.')
  console.error('')
  console.error('COMO SEGUIR:')
  console.error("  1. confira o SQL das migrations acima (aditivo? destrutivo?);")
  console.error('  2. defina no projeto, para ESTE deploy:')
  console.error('       MIGRATE_ON_BUILD=1')
  console.error("       EU_CONFIRMO_ESCRITA_EM_PRODUCAO='SIM, ESCREVER EM PRODUCAO'")
  console.error('  3. faça o redeploy — o prod-migrate-guard aplica com as travas dele;')
  console.error('  4. REMOVA as duas variáveis depois do deploy.')
  console.error('')
  process.exit(1)
} catch (e) {
  console.error(`[migration-guard] ABORTADO: não foi possível verificar o ledger do alvo — ${String(e).slice(0, 200)}`)
  console.error('[migration-guard] Sem essa leitura não há como afirmar que o schema comporta este código.')
  process.exit(1)
} finally {
  await prisma.$disconnect().catch(() => {})
}
