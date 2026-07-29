// scripts/prod-reconciliar-sequencias.mjs
// ============================================================================
// Gate de build: alinha as sequências de código público com as tabelas.
// Roda em production e em preview (homologação) — nos dois o sintoma é o mesmo
// (create estourando P2002 no publicCode) e o reparo é idêntico e idempotente.
//
// NÃO derruba o build: o gerador já se autocura em runtime; esta etapa só evita
// que o primeiro create de cada escopo pague o pato.
// ============================================================================
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { identificador } from '../lib/db/identidade-banco.mjs'

const log = (m) => console.log(`[sequencias] ${m}`)

if (!process.env.VERCEL_ENV) { log('fora da Vercel — pulando.'); process.exit(0) }
const url = process.env.PRISMA_DATABASE_URL
if (!url) { log('PRISMA_DATABASE_URL ausente — pulando.'); process.exit(0) }
log(`alvo: ${identificador(url)}`)

const r = spawnSync(path.join(process.cwd(), 'node_modules', '.bin', 'tsx'),
  ['scripts/reconciliar-sequencias-codigo.ts'], { stdio: 'inherit', env: process.env })

if (r.status !== 0) log(`AVISO: reconciliação não concluiu (exit ${r.status}). O gerador segue se autocurando em runtime.`)
process.exit(0)
