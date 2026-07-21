#!/usr/bin/env node
// scripts/preflight-db.mjs
// ============================================================================
// CHECKLIST EXECUTÁVEL — obrigatório antes de qualquer deploy que altere banco.
// Só leitura. Falha fechada: qualquer item reprovado sai com código 1.
//
//   npm run db:preflight
// ============================================================================
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { CLASSE, classificar, identificador, retratar, validarShadow } from '../lib/db/identidade-banco.mjs'

const RAIZ = join(import.meta.dirname, '..')
let falhas = 0
const item = (nome, ok, detalhe = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${nome}${detalhe ? ` — ${detalhe}` : ''}`)
  if (!ok) falhas++
}

console.log('\nCHECKLIST PRÉ-DEPLOY COM ALTERAÇÃO DE BANCO\n')

// 1 · backup recente
console.log('1. Backup')
const backups = readdirSync(process.env.HOME || '.', { withFileTypes: true })
  .filter((d) => d.isFile() && /^discovery.*\.(dump|sql)$/i.test(d.name))
item('existe backup local do Discovery', backups.length > 0, `${backups.length} arquivo(s)`)
item('PITR confirmado no provedor (manual)', process.env.PITR_CONFIRMADO === '1', 'defina PITR_CONFIRMADO=1 após conferir no console')

// 2 · banco correto
console.log('\n2. Identidade do banco alvo')
const url = process.env.PRISMA_DATABASE_URL
if (!url) {
  item('PRISMA_DATABASE_URL definida', false)
} else {
  const { PrismaClient } = await import('@prisma/client')
  const prisma = new PrismaClient({ datasources: { db: { url } } })
  try {
    const r = await retratar(prisma)
    const classe = classificar(r)
    item(`alvo identificado: ${identificador(url)}`, true, `${classe}`)
    item('tabelas sentinela presentes', r.sentinelasAusentes.length === 0, r.sentinelasAusentes.join(', ') || 'todas')
    item('classificado como PRODUCAO', classe === CLASSE.PRODUCAO, classe)
    item('contagens registradas antes da mudança', true, `${r.tabelas} tabelas · ${r.migrations} migrations · ${r.requerentes} requerentes`)
  } catch (e) {
    item('conexão de leitura', false, String(e.message).slice(0, 90))
  } finally {
    await prisma.$disconnect()
  }
}

// 3 · shadow separado
console.log('\n3. Shadow database')
const v = validarShadow({ shadowUrl: process.env.SHADOW_DATABASE_URL, mainUrl: url })
item('shadow separado e descartável', v.ok, v.motivo || identificador(process.env.SHADOW_DATABASE_URL))

// 4 · migrations revisadas
console.log('\n4. Migrations')
const dir = join(RAIZ, 'prisma/migrations')
const migs = existsSync(dir) ? readdirSync(dir).filter((d) => /^\d/.test(d)) : []
item('migrations versionadas no repositório', migs.length > 0, `${migs.length}`)
const destrutivas = []
for (const m of migs) {
  const p = join(dir, m, 'migration.sql')
  if (!existsSync(p)) continue
  const sql = readFileSync(p, 'utf8')
  if (/DROP\s+(TABLE|COLUMN|SCHEMA|DATABASE)|TRUNCATE/i.test(sql)) destrutivas.push(m)
}
item('nenhuma migration pendente é destrutiva', destrutivas.length === 0, destrutivas.slice(-3).join(', ') || 'nenhuma')

// 5 · plano de rollback
console.log('\n5. Rollback')
const rollbacks = readdirSync(process.env.HOME || '.').filter((f) => /^\.discovery-rollback/.test(f))
item('registro de rollback existe', rollbacks.length > 0, rollbacks.join(', ') || 'crie ~/.discovery-rollback-<data>.md')

console.log(`\n${falhas === 0 ? 'PREFLIGHT OK — pode prosseguir.' : `PREFLIGHT REPROVADO — ${falhas} item(ns). NÃO prossiga.`}\n`)
process.exit(falhas === 0 ? 0 : 1)
