#!/usr/bin/env node
// scripts/aplicar-migrations-pendentes.mjs
// ============================================================================
// Aplica migrations ADITIVAS pendentes no banco de PRODUÇÃO (V2) de forma
// idempotente (ADD COLUMN IF NOT EXISTS), quando o migrate-on-build está
// desligado. Trava de identidade: só escreve se o alvo for PRODUCAO.
//
//   PRISMA_DATABASE_URL='...' node scripts/aplicar-migrations-pendentes.mjs
//
// Só executa DDL aditivo dos arquivos migration.sql listados abaixo. Seguro para
// rodar mais de uma vez. Não apaga nada, não altera dados (exceto backfill IF).
// ============================================================================
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { CLASSE, classificar, identificador, retratar } from '../lib/db/identidade-banco.mjs'

const RAIZ = join(import.meta.dirname, '..')

// Migrations desta entrega (Fase 1). Ordem irrelevante (tabelas independentes).
const MIGRATIONS = [
  '20260730000000_forma_pagamento_capacidades',
  '20260729000000_condicao_regra_reutilizavel',
]

const url = process.env.PRISMA_DATABASE_URL
if (!url) {
  console.error('ABORTADO: defina PRISMA_DATABASE_URL no ambiente antes de rodar.')
  process.exit(1)
}

const { PrismaClient } = await import('@prisma/client')
const prisma = new PrismaClient({ datasources: { db: { url } } })

/** Divide o SQL em statements, ignorando linhas de comentário. */
function statements(sql) {
  return sql
    .split('\n').filter((l) => !l.trim().startsWith('--')).join('\n')
    .split(';').map((s) => s.trim()).filter(Boolean)
}

try {
  const retrato = await retratar(prisma)
  const classe = classificar(retrato)
  console.log(`\nAlvo: ${identificador(url)}`)
  console.log(`Retrato: ${retrato.tabelas} tabelas · ${retrato.requerentes} requerentes · classe ${classe}`)
  if (classe !== CLASSE.PRODUCAO) {
    console.error(`ABORTADO: alvo não tem assinatura de PRODUÇÃO (classificado ${classe}). Nada escrito.`)
    process.exit(1)
  }

  for (const m of MIGRATIONS) {
    const sql = readFileSync(join(RAIZ, 'prisma/migrations', m, 'migration.sql'), 'utf8')
    const stmts = statements(sql)
    for (const s of stmts) await prisma.$executeRawUnsafe(s)
    console.log(`  ✓ ${m} — ${stmts.length} statement(s) aplicado(s)`)
  }

  // Verificação: colunas-sentinela presentes
  const forma = await prisma.$queryRawUnsafe(
    `SELECT column_name FROM information_schema.columns WHERE table_name='FormaPagamentoCadastro' AND column_name IN ('moedasAceitas','tipoIntegracao','prazoLiquidacao','carteirasCompativeis') ORDER BY column_name`,
  )
  const cond = await prisma.$queryRawUnsafe(
    `SELECT column_name FROM information_schema.columns WHERE table_name='CondicaoPagamento' AND column_name IN ('politicaTaxas','formaSugeridaId','servicos','entradaTipo') ORDER BY column_name`,
  )
  console.log('\nVerificação:')
  console.log('  Forma:', forma.map((r) => r.column_name).join(', ') || '(nenhuma!)')
  console.log('  Condição:', cond.map((r) => r.column_name).join(', ') || '(nenhuma!)')

  const okForma = forma.length === 4, okCond = cond.length === 4
  console.log(`\n${okForma && okCond ? '✅ OK — colunas presentes. Pode avisar para eu re-deployar a Fase 1.' : '⚠️ Faltam colunas — revise o output acima.'}`)
  if (!(okForma && okCond)) process.exit(1)
} catch (err) {
  console.error('ERRO:', String(err?.message ?? err).slice(0, 400))
  process.exit(1)
} finally {
  await prisma.$disconnect()
}
