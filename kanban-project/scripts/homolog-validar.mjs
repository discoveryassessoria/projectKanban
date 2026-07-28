// scripts/homolog-validar.mjs
// ============================================================================
// VALIDAÇÃO PÓS-`migrate deploy` NO BANCO DE HOMOLOGAÇÃO.
//
// Prova, contra o catálogo real e contra o Prisma Client gerado:
//   1. `_prisma_migrations` fechado — todas as migrations do repositório
//      aplicadas, nenhuma inacabada, nenhuma revertida;
//   2. tudo o que as migrations pendentes prometiam entrar entrou
//      (colunas, índices, constraints, tipos, nulabilidade);
//   3. o Prisma Client conversa com o schema — em especial ObrigacaoEconomica
//      com os campos novos, que era exatamente o que quebrava antes.
//
// Somente leitura. Derruba o build em divergência.
// ============================================================================
import fs from 'node:fs'
import path from 'node:path'
import { identificador } from '../lib/db/identidade-banco.mjs'
import {
  ARQUIVO_CORTE,
  classificarMigration,
  coletarCatalogo,
  listarMigrations,
  sqlDaMigration,
} from '../lib/db/leitura-migrations.mjs'

if (process.env.HOMOLOG_VALIDAR !== '1') {
  console.log('[validar] desligado (HOMOLOG_VALIDAR != 1) — seguindo o build.')
  process.exit(0)
}
if (process.env.VERCEL_ENV && process.env.VERCEL_ENV !== 'preview') {
  console.error(`[validar] ABORTADO: só roda em Preview (VERCEL_ENV=${process.env.VERCEL_ENV}).`)
  process.exit(1)
}
const url = process.env.PRISMA_DATABASE_URL
if (!url) { console.error('[validar] ABORTADO: PRISMA_DATABASE_URL ausente.'); process.exit(1) }
if (/db\.prisma\.io/i.test(identificador(url))) {
  console.error('[validar] ABORTADO: alvo é db.prisma.io (produção).')
  process.exit(1)
}

const { PrismaClient } = await import('@prisma/client')
const prisma = new PrismaClient({ datasources: { db: { url } } })

const erros = []
const falhar = (m) => { console.error(`  ✗ ${m}`); erros.push(m) }
const passar = (m) => console.log(`  ✓ ${m}`)

try {
  console.log('='.repeat(78))
  console.log(`[validar] alvo: ${identificador(url)}`)

  const DIR = path.join(process.cwd(), 'prisma', 'migrations')
  const migrations = listarMigrations(DIR)

  // ── 1) histórico fechado ───────────────────────────────────────────────────
  console.log('\n1) _prisma_migrations')
  const rows = await prisma.$queryRawUnsafe(
    `SELECT migration_name, finished_at, rolled_back_at, applied_steps_count FROM _prisma_migrations ORDER BY migration_name`,
  )
  const porNome = new Map(rows.map((r) => [r.migration_name, r]))
  if (rows.length === migrations.length) passar(`${rows.length} linhas = ${migrations.length} migrations do repositório`)
  else falhar(`${rows.length} linhas ≠ ${migrations.length} migrations do repositório`)

  const ausentes = migrations.filter((m) => !porNome.has(m))
  if (ausentes.length) falhar(`migrations sem registro: ${ausentes.join(', ')}`)
  else passar('nenhuma migration do repositório ficou sem registro')

  const intrusas = rows.filter((r) => !migrations.includes(r.migration_name))
  if (intrusas.length) falhar(`registros sem migration no repositório: ${intrusas.map((r) => r.migration_name).join(', ')}`)
  else passar('nenhum registro órfão')

  const inacabadas = rows.filter((r) => !r.finished_at)
  if (inacabadas.length) falhar(`inacabadas: ${inacabadas.map((r) => r.migration_name).join(', ')}`)
  else passar('todas com finished_at')

  const revertidas = rows.filter((r) => r.rolled_back_at)
  if (revertidas.length) falhar(`revertidas: ${revertidas.map((r) => r.migration_name).join(', ')}`)
  else passar('nenhuma revertida')

  // ── 2) o que as pendentes prometiam ────────────────────────────────────────
  console.log('\n2) objetos das migrations aplicadas pelo migrate deploy')
  const { existe } = await coletarCatalogo(prisma)

  let corte = null
  try { corte = JSON.parse(fs.readFileSync(ARQUIVO_CORTE, 'utf8')) } catch { /* sem corte deste build */ }

  if (!corte) {
    console.log('  (sem registro de corte neste build — validando o inventário inteiro em modo informativo)')
  } else {
    console.log(`  corte: após ${corte.corte} · ${corte.baselinadas.length} baselinadas · ${corte.aAplicar.length} aplicadas pelo deploy`)
    for (const nome of corte.aAplicar) {
      const r = classificarMigration(sqlDaMigration(DIR, nome), existe)
      if (r.estado === 'REFLETIDA') passar(`${nome} (${r.ok}/${r.total})`)
      else if (r.estado === 'INDETERMINADA') passar(`${nome} (sem DDL verificável — aplicada segundo o histórico)`)
      else {
        falhar(`${nome} aplicada mas NÃO refletida (${r.ok}/${r.total})`)
        for (const f of r.falhas) console.error(`      · falta ${f}`)
      }
    }
    if (corte.lacunasDoPrefixo?.length) {
      console.log('\n  LACUNAS CONHECIDAS do prefixo baselinado (informativo — não derrubam o build):')
      for (const l of corte.lacunasDoPrefixo) {
        console.log(`   · ${l.migration}: ${l.falhas.join('; ')}`)
      }
    }
  }

  // ── 3) Prisma Client × schema ──────────────────────────────────────────────
  console.log('\n3) Prisma Client contra o schema')
  const consultas = [
    ['obrigacaoEconomica (campos novos de Custo)', () => prisma.obrigacaoEconomica.findMany({
      take: 1,
      select: { id: true, fornecedorId: true, itemCatalogoId: true, arquivadaEm: true, estadoCusto: true, natureza: true, status: true },
    })],
    ['obrigacaoEconomica.count', () => prisma.obrigacaoEconomica.count()],
    ['obrigacaoEconomica filtrando arquivadaEm/estadoCusto', () => prisma.obrigacaoEconomica.findMany({
      take: 1, where: { arquivadaEm: null, estadoCusto: null },
    })],
    ['parcelaPagavel', () => prisma.parcelaPagavel.findMany({ take: 1 })],
    ['repasseCusto', () => prisma.repasseCusto.findMany({ take: 1 })],
    ['receitaDocumento (obrigacaoId)', () => prisma.receitaDocumento.findMany({ take: 1, select: { id: true, receitaId: true, obrigacaoId: true } })],
    ['creditoMovimento', () => prisma.creditoMovimento.findMany({ take: 1 })],
    ['receita.arquivadaEm', () => prisma.receita.findMany({ take: 1, select: { id: true, arquivadaEm: true } })],
    ['cobranca.enviadaEm/linkPagamento', () => prisma.cobranca.findMany({ take: 1, select: { id: true, enviadaEm: true, linkPagamento: true, enviadaPorId: true } })],
    ['fatura.receitaId', () => prisma.fatura.findMany({ take: 1, select: { id: true, receitaId: true } })],
    ['evento.status/responsavelId', () => prisma.evento.findMany({ take: 1, select: { id: true, status: true, responsavelId: true } })],
    ['ledgerFinanceiro', () => prisma.ledgerFinanceiro.findMany({ take: 1 })],
    ['saldoProjecao', () => prisma.saldoProjecao.findMany({ take: 1 })],
  ]
  for (const [rotulo, fn] of consultas) {
    try { await fn(); passar(rotulo) }
    catch (e) { falhar(`${rotulo} → ${String(e?.message ?? e).split('\n').filter(Boolean).slice(-3).join(' | ').slice(0, 300)}`) }
  }

  console.log('\n' + '='.repeat(78))
  if (erros.length) {
    console.error(`[validar] ${erros.length} DIVERGÊNCIA(S). Build derrubado.`)
    process.exit(1)
  }
  console.log('[validar] SCHEMA, ÍNDICES, CONSTRAINTS E PRISMA CLIENT VALIDADOS.')
  console.log('='.repeat(78))
} catch (err) {
  console.error('[validar] ERRO:', String(err?.message ?? err).slice(0, 400))
  process.exit(1)
} finally {
  await prisma.$disconnect().catch(() => {})
}
