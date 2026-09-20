// scripts/baseline-integridade-real.test.ts
// ============================================================================
// PROVA REAL — baseline (histórico, imutável) + migrations aditivas
// posteriores reconstroem EXATAMENTE o schema.prisma atual.
//
// COMPLEMENTA `baseline-verificar.test.ts` (offline, sem banco, roda no
// build): aquele garante que nada foi editado à mão e que toda migration está
// contabilizada. Este aqui prova, com um Postgres de verdade, que aplicar
// baseline.sql + as migrations que o manifesto NÃO marca como absorvidas
// produz um banco idêntico ao schema.prisma — sem tocar em produção, sem
// reconciliar checksum nenhum.
//
// Usa `prisma/baseline/migrations-absorvidas.json` para saber quais
// migrations já estão dentro do baseline atual (marcadas `resolve --applied`,
// sem reexecutar SQL) e quais são genuinamente novas (replay de verdade).
//
//   node scripts/mrg-banco-teste.mjs up   (ou qualquer Postgres local vazio)
//   npx tsx scripts/baseline-integridade-real.test.ts
//
// Cria e derruba bancos próprios (discovery_baseline_integridade_*) — nunca
// toca em discovery_test nem em produção.
// ============================================================================
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..')
const BASELINE_SQL = join(RAIZ, 'prisma', 'baseline', 'baseline.sql')
const DIR_MIGRATIONS = join(RAIZ, 'prisma', 'migrations')
const MANIFESTO = join(RAIZ, 'prisma', 'baseline', 'migrations-absorvidas.json')
const SCHEMA = join(RAIZ, 'prisma', 'schema.prisma')
const PRISMA = join(RAIZ, 'node_modules', '.bin', 'prisma')

const HOST = process.env.MRG_TEST_PORT ? '127.0.0.1' : '127.0.0.1'
const PORTA = process.env.MRG_TEST_PORT || '55432'
const ADMIN_URL = `postgresql://postgres@${HOST}:${PORTA}/postgres`
const BANCO = 'discovery_baseline_integridade_scratch'

let passou = 0, falhou = 0
const falhas: string[] = []
const ok = (nome: string, cond: boolean, extra = '') => {
  if (cond) { passou++; console.log(`  ✅ ${nome}${extra ? ` — ${extra}` : ''}`) }
  else { falhou++; falhas.push(nome); console.log(`  ❌ ${nome}${extra ? ` — ${extra}` : ''}`) }
}

function exec(cmd: string, args: string[], env: Record<string, string> = {}) {
  return execFileSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: { ...process.env, ...env } })
}

async function main() {
  console.log('BASELINE — prova real: histórico imutável + migrations aditivas = schema atual\n')

  if (!existsSync(BASELINE_SQL)) { console.error('prisma/baseline/baseline.sql não existe.'); process.exitCode = 1; return }
  if (!existsSync(MANIFESTO)) { console.error('prisma/baseline/migrations-absorvidas.json não existe — rode npm run baseline:gerar ao menos uma vez.'); process.exitCode = 1; return }

  const manifesto = JSON.parse(readFileSync(MANIFESTO, 'utf8')) as { baselineChecksum: string; migrationsAbsorvidas: string[] }
  const todasPastas = readdirSync(DIR_MIGRATIONS, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name !== '0000_baseline')
    .map((d) => d.name)
    .sort()
  const novas = todasPastas.filter((n) => !manifesto.migrationsAbsorvidas.includes(n))

  console.log(`  migrations absorvidas pelo baseline (skip): ${manifesto.migrationsAbsorvidas.length}`)
  console.log(`  migrations genuinamente novas (replay real): ${novas.length}${novas.length ? ' — ' + novas.join(', ') : ''}`)

  // ── administração do banco de prova ────────────────────────────────────
  const psqlAdmin = (sql: string) => exec('psql', [ADMIN_URL, '-v', 'ON_ERROR_STOP=1', '-c', sql])
  psqlAdmin(`DROP DATABASE IF EXISTS ${BANCO}`)
  psqlAdmin(`CREATE DATABASE ${BANCO}`)

  const URL = `postgresql://postgres@${HOST}:${PORTA}/${BANCO}`

  try {
    // 1) aplica o baseline HISTÓRICO como SQL bruto — é para isso que ele existe.
    exec('psql', ['-h', HOST, '-p', PORTA, '-U', 'postgres', '-d', BANCO, '-v', 'ON_ERROR_STOP=1', '-f', BASELINE_SQL])
    ok('baseline.sql (histórico) aplicou sem erro no banco vazio', true)

    // 2) marca baseline + migrations absorvidas como aplicadas (bookkeeping —
    //    NUNCA reexecuta SQL delas: o baseline já criou o efeito).
    for (const nome of ['0000_baseline', ...manifesto.migrationsAbsorvidas]) {
      exec(PRISMA, ['migrate', 'resolve', '--applied', nome], { PRISMA_DATABASE_URL: URL, DIRECT_DATABASE_URL: URL })
    }
    ok(`${manifesto.migrationsAbsorvidas.length + 1} migration(s) histórica(s) marcada(s) como aplicada(s) (sem reexecutar SQL)`, true)

    // 3) só as NOVAS (não absorvidas) rodam de verdade.
    //    `migrate status` sai com código != 0 quando há pendência — comportamento
    //    normal (pensado para CI), não falha desta prova. O que importa é o texto.
    let statusAntes: string
    try {
      statusAntes = exec(PRISMA, ['migrate', 'status'], { PRISMA_DATABASE_URL: URL, DIRECT_DATABASE_URL: URL })
    } catch (e) {
      statusAntes = String((e as { stdout?: string }).stdout ?? e)
    }
    ok('status antes do deploy lista exatamente as migrations novas como pendentes',
      novas.every((n) => statusAntes.includes(n)) && (novas.length === 0 || statusAntes.includes('have not yet been applied')),
      novas.join(', ') || '(nenhuma)')

    const deploy = exec(PRISMA, ['migrate', 'deploy'], { PRISMA_DATABASE_URL: URL, DIRECT_DATABASE_URL: URL })
    ok('prisma migrate deploy aplicou as migrations novas sem erro', deploy.includes('successfully applied') || novas.length === 0)

    // 4) PROVA — zero diferença contra schema.prisma.
    const diff = exec(PRISMA, ['migrate', 'diff', '--from-url', URL, '--to-schema-datamodel', SCHEMA, '--script'])
    const semDiferenca = diff.trim() === '-- This is an empty migration.'
    ok('baseline + migrations aditivas reconstroem EXATAMENTE o schema.prisma atual (zero diferença)', semDiferenca,
      semDiferenca ? '' : diff.slice(0, 400))
  } finally {
    psqlAdmin(`DROP DATABASE IF EXISTS ${BANCO}`)
  }

  console.log(`\n${passou} ok, ${falhou} falhas`)
  if (falhou > 0) process.exitCode = 1
}

main().catch((e) => { console.error(e); process.exitCode = 1 })
