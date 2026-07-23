// scripts/cambio-idempotencia-guard.test.ts
// GUARDA estrutural do backend: resolução de cotação, snapshot cambial, gross-up
// e idempotência real na criação da cobrança. Inspeciona o fonte + schema.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
const RAIZ = join(__dirname, '..')
let passou = 0, falhou = 0
const ok = (n: string, c: boolean) => { if (c) { passou++; console.log(`  ✓ ${n}`) } else { falhou++; console.log(`  ✗ ${n}`) } }
const rd = (p: string) => readFileSync(join(RAIZ, p), 'utf8')

console.log('\nBackend — câmbio, snapshot, gross-up e idempotência')

// ── cotação (autoridade do backend; nunca 1 silencioso) ──
const runtime = rd('lib/financeiro/charge-runtime.ts')
ok('runtime resolve cotação (resolverCotacao)', runtime.includes('resolverCotacao') && runtime.includes('moedaRecebimento'))
ok('runtime BLOQUEIA quando cotação indisponível', runtime.includes('if (cambio.bloqueio) return'))
ok('runtime devolve cotação p/ snapshot', runtime.includes('cambio,'))

const resolver = rd('lib/financeiro/cotacao-resolver.ts')
ok('automática via CotacaoCambio vigente', resolver.includes('cotacaoCambio.findMany') && resolver.includes("vigente"))
ok('manual exige autorização', resolver.includes('autorizadoManual') && resolver.includes('MANUAL_NAO_AUTORIZADA'))
ok('estimada é fallback ROTULADO (não silencioso)', resolver.includes("'ESTIMADA'") && resolver.includes('fxEstimadoFallback'))
ok('indisponível bloqueia', resolver.includes("'INDISPONIVEL'") && resolver.includes('bloqueio'))
ok('direção direta/inversa (BRL→EUR)', rd('lib/financeiro/cambio-conversao.ts').includes('INVERSA') && rd('lib/financeiro/cambio-conversao.ts').includes('1 / taxa'))

// ── gross-up real (repasse) ──
const calc = rd('lib/financeiro/charge-calculation-service.ts')
ok('gross-up no repasse: saldo / (1 − p)', calc.includes('(baseTaxavel + fixoTaxa) / (1 - pFrac)') && calc.includes('Gross-up'))
ok('gross-up só sobre o saldo (entrada intocada)', calc.includes('valorEntrada + totalSaldo'))
ok('bloqueia taxa ≥ 100% (gross-up inviável)', calc.includes("codigo: 'TAXA_INVIAVEL'"))
ok('câmbio origem→destino no resultado', calc.includes('moedaDestino') && calc.includes('cotacao'))

// ── snapshot cambial + idempotência na criação ──
const criar = rd('src/app/api/financeiro/receitas/[id]/cobrancas/route.ts')
ok('idempotência: reusa cobrança existente pela chave', criar.includes('idempotencyKey') && criar.includes('findUnique({ where: { idempotencyKey }'))
ok('idempotência: corrida trata P2002 (retry seguro)', criar.includes("e.code === 'P2002'"))
ok('persiste snapshot cambial completo', criar.includes('moedaDestino: cambio.moedaDestino') && criar.includes('cotacaoTipo: cambio.tipo') && criar.includes('cotacaoManualPorId'))
ok('snapshot cambial também no JSON (memoriaCalculo)', criar.includes('cambio: snapshotCambial'))
ok('cotação manual só p/ admin/edita valores', criar.includes("temPermissao(usuario.permissoes, 'financeiro.custos_editar')"))

// ── schema/migration aditivos ──
const schema = rd('prisma/schema.prisma')
ok('schema: idempotencyKey único', schema.includes('idempotencyKey String? @unique'))
ok('schema: snapshot cambial (moedaDestino/cotacaoTipo/cotacaoId)', schema.includes('moedaDestino') && schema.includes('cotacaoTipo') && schema.includes('cotacaoManualPorId'))
const mig = rd('prisma/migrations/20260807000000_cobranca_cambio_idempotencia/migration.sql')
ok('migration idempotente (ADD COLUMN IF NOT EXISTS + índice único)', mig.includes('ADD COLUMN IF NOT EXISTS "idempotencyKey"') && mig.includes('CREATE UNIQUE INDEX IF NOT EXISTS'))
ok('migration no aplicador de build', rd('scripts/prod-apply-cadastros-aditivas.mjs').includes('20260807000000_cobranca_cambio_idempotencia'))

console.log(`\nBackend câmbio/idempotência: ${passou} passaram, ${falhou} falharam`)
if (falhou > 0) process.exit(1)
