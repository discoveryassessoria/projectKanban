// scripts/homolog-smokes.mjs
// ============================================================================
// SMOKES DE HOMOLOGAÇÃO — roda as suítes de Receitas e Custos DENTRO do build do
// Preview, que é o único lugar com acesso ao banco de homologação.
//
// Ligado por HOMOLOG_SMOKE=1. Só Preview. Não roda contra produção.
// Derruba o build em falha: smoke que não reprova não prova nada.
// ============================================================================
import { spawnSync } from 'node:child_process'
import { identificador } from '../lib/db/identidade-banco.mjs'

if (process.env.HOMOLOG_SMOKE !== '1') {
  console.log('[smokes] desligado (HOMOLOG_SMOKE != 1) — seguindo o build.')
  process.exit(0)
}
if (process.env.VERCEL_ENV && process.env.VERCEL_ENV !== 'preview') {
  console.error(`[smokes] ABORTADO: só roda em Preview (VERCEL_ENV=${process.env.VERCEL_ENV}).`)
  process.exit(1)
}
const url = process.env.PRISMA_DATABASE_URL
if (!url) { console.error('[smokes] ABORTADO: PRISMA_DATABASE_URL ausente.'); process.exit(1) }
if (/db\.prisma\.io/i.test(identificador(url))) {
  console.error('[smokes] ABORTADO: alvo é db.prisma.io (produção).')
  process.exit(1)
}
console.log(`[smokes] alvo: ${identificador(url)}`)

const SUITES = [
  ['Autenticação e sessão', 'test:auth'],
  ['Catálogo de Serviços', 'test:catalogo-servicos-homolog'],
  ['Receitas', 'test:receitas-processo'],
  ['Receitas · exclusão', 'test:excluir-receita'],
  ['Receitas · exclusão (lista)', 'test:excluir-receita-lista'],
  ['Custos', 'test:custos'],
]

const falhas = []
for (const [rotulo, script] of SUITES) {
  console.log(`\n${'─'.repeat(70)}\n[smokes] ▶ ${rotulo} (npm run ${script})\n${'─'.repeat(70)}`)
  const r = spawnSync('npm', ['run', '--silent', script], {
    stdio: 'inherit',
    env: { ...process.env, DIRECT_DATABASE_URL: url },
  })
  if (r.status !== 0) {
    console.error(`[smokes] ✗ ${rotulo} FALHOU (exit ${r.status}).`)
    falhas.push(rotulo)
  } else {
    console.log(`[smokes] ✓ ${rotulo} OK.`)
  }
}

console.log(`\n[smokes] resultado: ${SUITES.length - falhas.length}/${SUITES.length} suítes OK.`)
if (falhas.length) {
  console.error(`[smokes] FALHARAM: ${falhas.join(', ')}`)
  process.exit(1)
}
console.log('[smokes] TODOS OS SMOKES PASSARAM.')
