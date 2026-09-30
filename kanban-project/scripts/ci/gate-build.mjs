#!/usr/bin/env node
// scripts/ci/gate-build.mjs
// ============================================================================
// A TRAVA DO DEPLOY — nenhuma versão vai para produção com teste vermelho.
//
// Roda no `npm run build` (Vercel) ANTES de qualquer efeito em produção (antes do guard de
// migration e do prod-migrate-guard, que ESCREVEM no banco de produção): se a suíte crítica
// falha, o build falha, nada é migrado e a produção continua na versão anterior.
//
//   node scripts/ci/gate-build.mjs            # a suíte crítica (scripts/ci/suite-critica.json)
//   node scripts/ci/gate-build.mjs --suite completa   # (diagnóstico manual; --todas via rodar-suite)
//
// Sobe um Postgres REAL descartável (`postgres-efemero.mjs`), monta nele o banco com as MESMAS
// migrations SQL de produção (`criar-banco-de-teste.mjs`, sem db push) e roda cada arquivo num
// banco novo clonado desse modelo. Os testes NUNCA recebem a URL de produção: o ambiente do
// filho é montado, não herdado (ver rodar-suite.mjs).
//
// NÃO HÁ VARIÁVEL DE "PULAR". Um gate com bypass não é gate; para publicar com a suíte
// vermelha só existe um caminho: corrigir o teste (ou o produto) e fazer push.
// ============================================================================
import { spawnSync } from 'node:child_process'
import { createServer } from 'node:net'
import { cpus } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { subirPostgresEfemero } from './postgres-efemero.mjs'

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const args = process.argv.slice(2)
const suite = args.includes('--suite') ? args[args.indexOf('--suite') + 1] : 'critica'

const portaLivre = () => new Promise((resolve, reject) => {
  const s = createServer(); s.unref(); s.on('error', reject)
  s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)) })
})

const t0 = Date.now()
console.log(`\n[gate] suíte "${suite}" — nenhum deploy sai com teste vermelho`)
const porta = await portaLivre()
const pg = await subirPostgresEfemero({ porta })
console.log(`[gate] Postgres efêmero em 127.0.0.1:${porta} (${((Date.now() - t0) / 1000).toFixed(1)}s)`)

const workers = Math.max(2, Math.min(8, cpus().length - 1))
const r = spawnSync('node', [
  join(RAIZ, 'scripts/ci/rodar-suite.mjs'), '--suite', suite, '--workers', String(workers),
  '--porta', String(porta), '--banco', 'discovery_test_gate', '--timeout', '300',
  '--log-dir', join(RAIZ, '.suite-logs'),
  // Filtro opcional, só para depuração local (`--so <fragmento>`); o build nunca o passa.
  ...(args.includes('--so') ? ['--so', args[args.indexOf('--so') + 1]] : []),
], { stdio: 'inherit', cwd: RAIZ })

pg.parar()
const seg = ((Date.now() - t0) / 1000).toFixed(0)
if (r.status !== 0) {
  console.error(`\n[gate] ⛔ SUÍTE VERMELHA (${seg}s) — o build PARA AQUI. Produção não foi tocada: continua na versão anterior.`)
  process.exit(1)
}
console.log(`\n[gate] ✅ suíte verde (${seg}s) — o build segue.`)
