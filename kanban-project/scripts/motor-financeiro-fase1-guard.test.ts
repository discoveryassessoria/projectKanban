// scripts/motor-financeiro-fase1-guard.test.ts
// GUARDA estrutural do Motor Financeiro V3 · Fase 1: aditivo, migration
// idempotente registrada, serviço transacional, escrita dupla desligada por
// padrão, princípios (Outbox/idempotência).
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
const RAIZ = join(__dirname, '..')
let passou = 0, falhou = 0
const ok = (n: string, c: boolean) => { if (c) { passou++; console.log(`  ✓ ${n}`) } else { falhou++; console.log(`  ✗ ${n}`) } }
const rd = (p: string) => readFileSync(join(RAIZ, p), 'utf8')

console.log('\nMotor Financeiro V3 · Fase 1 — estrutura')
const schema = rd('prisma/schema.prisma')
for (const m of ['ObrigacaoEconomica', 'LedgerFinanceiro', 'LedgerEntry', 'PlanoContaFinanceira', 'LedgerOpeningBalance', 'OcorrenciaFinanceira', 'AplicacaoFinanceira', 'DistribuicaoEconomica', 'ParticipacaoEconomica', 'Pagador', 'ParteExterna', 'PoliticaCambial', 'SnapshotCambial', 'CreditoFinanceiro', 'SaldoProjecao', 'SaldoSnapshot']) {
  ok(`model ${m}`, new RegExp(`model ${m} \\{`).test(schema))
}
ok('aggregate com optimistic locking (version)', /model ObrigacaoEconomica[\s\S]*?version\s+Int\s+@default\(0\)/.test(schema))
ok('LedgerEntry double-entry (direcao + contaContabil + transacaoId)', /model LedgerEntry[\s\S]*?direcao[\s\S]*?contaContabil[\s\S]*?transacaoId/.test(schema))
ok('idempotência: LedgerEntry.idempotencyKey @unique', /model LedgerEntry[\s\S]*?idempotencyKey\s+String\?\s+@unique/.test(schema))
ok('Obrigacao 1:1 origem (backfill idempotente)', /@@unique\(\[origemTipo, origemId\]\)/.test(schema))
ok('Cobranca.obrigacaoId aditivo (legado)', /obrigacaoId\s+Int\?\s+\/\/ → ObrigacaoEconomica/.test(schema))

const migRaw = rd('prisma/migrations/20260808000000_motor_financeiro_v3_fase1/migration.sql')
const mig = migRaw.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n') // ignora comentários
ok('migration idempotente (CREATE TABLE IF NOT EXISTS)', (mig.match(/CREATE TABLE IF NOT EXISTS/g) || []).length >= 16)
ok('migration só aditiva (nenhum DROP/ALTER destrutivo em statements)', !/\bDROP TABLE\b/.test(mig) && !/\bDROP COLUMN\b/.test(mig) && mig.includes('ADD COLUMN IF NOT EXISTS "obrigacaoId"'))
ok('migration registrada no aplicador de build', rd('scripts/prod-apply-cadastros-aditivas.mjs').includes('20260808000000_motor_financeiro_v3_fase1'))
ok('seed plano de contas no build', rd('package.json').includes('prod-seed-plano-contas.mjs'))

const svc = rd('lib/financeiro/ledger/ledger-service.ts')
ok('serviço transacional ($transaction) + replay', svc.includes('$transaction') && svc.includes('recomputarProjecao') && svc.includes('projetar'))
ok('OBRIGACAO_CRIADA gera lançamento + evento Outbox', svc.includes('lancObrigacaoCriada') && svc.includes("domainOutbox.create") && svc.includes('financeiro.obrigacao.criada'))
ok('idempotência por origem (findUnique origemTipo_origemId)', svc.includes('origemTipo_origemId'))

const dw = rd('lib/financeiro/dual-write.ts')
ok('escrita dupla DESLIGADA por padrão (flag)', dw.includes("process.env.FINANCEIRO_DUAL_WRITE === '1'"))
ok('escrita dupla é best-effort (nunca quebra o legado)', dw.includes('NUNCA lança') || dw.includes('catch'))
ok('rota de cobrança usa a escrita dupla', rd('src/app/api/financeiro/receitas/[id]/cobrancas/route.ts').includes('espelharReceitaComoObrigacao'))

console.log(`\nMotor Financeiro V3 Fase 1 (estrutura): ${passou} passaram, ${falhou} falharam`)
if (falhou > 0) process.exit(1)
