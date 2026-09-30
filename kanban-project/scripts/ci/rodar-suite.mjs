#!/usr/bin/env node
// scripts/ci/rodar-suite.mjs
// ============================================================================
// O EXECUTOR DE SUÍTES — o que faz "teste falhou ⇒ deploy não sai".
//
//   node scripts/ci/rodar-suite.mjs --suite critica            # manifesto scripts/ci/suite-critica.json
//   node scripts/ci/rodar-suite.mjs --todas                    # todo scripts/*.test.ts (diagnóstico)
//   opções: --workers N (padrão 1)  --timeout 300 (s por arquivo)  --banco discovery_test_ci
//           --porta 55432  --host 127.0.0.1  --sem-criar-banco (usa o --banco já pronto)
//           --so <fragmento>  (filtra por nome)  --log-dir <pasta>
//
// Cada arquivo roda em processo próprio (`tsx`), com o ambiente MONTADO AQUI e nunca herdado:
// as URLs de banco do processo pai (que na Vercel são as de PRODUÇÃO) são descartadas e
// substituídas pelo banco de teste local. Um teste jamais enxerga a URL de produção.
//
// Cada worker tem o PRÓPRIO banco (cópia do banco-modelo por TEMPLATE): nada de teste
// disputando as mesmas linhas com outro.
//
// SAÍDA: uma linha por arquivo (PASSOU/FALHOU/TIMEOUT + tempo) e um resumo. Código de saída 1
// se QUALQUER arquivo falhar ou estourar o tempo — é isso que derruba o build.
//
// ISOLAMENTO COM JUSTIFICATIVA (nunca skip silencioso): um teste que não pode rodar no gate por
// motivo alheio declara, NO PRÓPRIO ARQUIVO, uma linha
//     // SUITE: isolado — <motivo escrito>
// O executor lista os isolados no relatório com o motivo, em todo run. Isolado sem motivo é erro.
// ============================================================================
import { spawn, execFileSync } from 'node:child_process'
import pg from 'pg'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const args = process.argv.slice(2)
const flag = (n) => args.includes(`--${n}`)
const opt = (n, padrao) => { const i = args.indexOf(`--${n}`); return i > -1 ? args[i + 1] : padrao }

const SUITE = opt('suite', flag('todas') ? 'todas' : 'critica')
const WORKERS = Math.max(1, Number(opt('workers', '1')))
const TIMEOUT_S = Number(opt('timeout', '300'))
const MODELO = opt('banco', 'discovery_test_ci')
const PORTA = opt('porta', process.env.MRG_TEST_PORT || '55432')
const HOST = opt('host', '127.0.0.1')
const USUARIO = opt('usuario', 'postgres')
const FILTRO = opt('so', '')
const LOG_DIR = opt('log-dir', join(RAIZ, '.suite-logs'))

const urlDe = (banco) => `postgresql://${USUARIO}@${HOST}:${PORTA}/${banco}`
const psql = async (sql, banco = 'postgres') => {
  const c = new pg.Client({ connectionString: urlDe(banco) }); await c.connect()
  try { await c.query(sql) } finally { await c.end() }
}

// ── QUAIS ARQUIVOS ──────────────────────────────────────────────────────────
const todosOsTestes = readdirSync(join(RAIZ, 'scripts')).filter((f) => f.endsWith('.test.ts')).sort().map((f) => `scripts/${f}`)
const cabecalho = (arq) => readFileSync(join(RAIZ, arq), 'utf8').split('\n').slice(0, 40).join('\n')
const isolamento = (arq) => {
  const m = /^\/\/\s*SUITE:\s*isolado\b\s*[—-]?\s*(.*)$/m.exec(cabecalho(arq))
  return m ? m[1].trim() : null
}

let arquivos
if (SUITE === 'todas') arquivos = todosOsTestes
else {
  const manifesto = JSON.parse(readFileSync(join(RAIZ, 'scripts/ci', `suite-${SUITE}.json`), 'utf8'))
  arquivos = manifesto.arquivos
  const faltando = arquivos.filter((a) => !existsSync(join(RAIZ, a)))
  if (faltando.length) { console.error(`⛔ o manifesto da suíte "${SUITE}" cita arquivo que não existe: ${faltando.join(', ')}`); process.exit(1) }
}
if (FILTRO) arquivos = arquivos.filter((a) => a.includes(FILTRO))

const isolados = arquivos.map((a) => ({ a, motivo: isolamento(a) })).filter((x) => x.motivo !== null)
const semMotivo = isolados.filter((x) => x.motivo.length < 15)
if (semMotivo.length) {
  console.error(`⛔ teste isolado SEM justificativa escrita (mínimo de uma frase no próprio arquivo): ${semMotivo.map((x) => x.a).join(', ')}`)
  process.exit(1)
}
const rodar = arquivos.filter((a) => !isolados.some((i) => i.a === a))

// ── BANCOS ──────────────────────────────────────────────────────────────────
const bancos = []
if (!flag('sem-criar-banco')) {
  console.log(`▶ criando o banco-modelo ${MODELO} com as migrations de produção…`)
  execFileSync('node', [join(RAIZ, 'scripts/ci/criar-banco-de-teste.mjs'), '--banco', MODELO, '--porta', PORTA, '--host', HOST, '--usuario', USUARIO], { stdio: 'inherit', cwd: RAIZ })
}
for (let w = 0; w < WORKERS; w++) {
  const nome = `${MODELO}_w${w}`
  bancos.push(nome)
}

mkdirSync(LOG_DIR, { recursive: true })
const tsx = join(RAIZ, 'node_modules', '.bin', 'tsx')

// CADA ARQUIVO RODA NUM BANCO NOVO, clonado do modelo por TEMPLATE (~1s): nenhum teste herda
// linha, contador ou estado do teste anterior — o resultado não depende da ORDEM nem de quem
// rodou antes. É o que separa "o teste está errado/o produto quebrou" de "sujeira alheia".
async function bancoLimpoPara(banco) {
  await psql(`DROP DATABASE IF EXISTS "${banco}" WITH (FORCE)`)
  await psql(`CREATE DATABASE "${banco}" TEMPLATE "${MODELO}"`)
}

async function rodarUm(arq, banco) {
  const t0 = Date.now()
  if (!flag('sem-isolar-banco') && banco !== MODELO) await bancoLimpoPara(banco)
  return new Promise((resolve) => {
    const url = urlDe(banco)
    // AMBIENTE MONTADO, NÃO HERDADO: só o que o teste precisa; nenhuma URL de produção passa.
    const env = {
      PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR,
      PRISMA_DATABASE_URL: url, DIRECT_DATABASE_URL: url, DATABASE_URL: url,
      JWT_SECRET: 'ci-suite-critica-nao-usar-em-producao',
      ADMIN_SEED_PASSWORD: 'ci-suite-critica-senha-de-teste-123',
      // `src/lib/r2.ts` exige estas variáveis JÁ NO IMPORT (só constrói o cliente S3). Valores
      // FALSOS de propósito: nenhum teste do gate pode falar com o storage real — se um tentar,
      // a chamada falha (credencial inválida, host `.invalid`) em vez de escrever em produção.
      R2_ACCOUNT_ID: 'ci-nao-usar', R2_ACCESS_KEY_ID: 'ci-nao-usar', R2_SECRET_ACCESS_KEY: 'ci-nao-usar',
      R2_BUCKET_NAME: 'ci-nao-usar', R2_PUBLIC_URL: 'https://ci.invalid',
      NODE_ENV: 'test', CI: '1',
    }
    const filho = spawn(tsx, [arq], { cwd: RAIZ, env, stdio: ['ignore', 'pipe', 'pipe'] })
    let saida = ''
    filho.stdout.on('data', (d) => { saida += d })
    filho.stderr.on('data', (d) => { saida += d })
    let estourou = false
    const timer = setTimeout(() => { estourou = true; filho.kill('SIGKILL') }, TIMEOUT_S * 1000)
    filho.on('close', (codigo) => {
      clearTimeout(timer)
      const seg = (Date.now() - t0) / 1000
      const nome = arq.replace(/^scripts\//, '').replace(/\.test\.ts$/, '')
      writeFileSync(join(LOG_DIR, `${nome}.log`), saida)
      resolve({ arq, seg, status: estourou ? 'TIMEOUT' : codigo === 0 ? 'PASSOU' : 'FALHOU', codigo, cauda: saida.split('\n').filter((l) => /❌|FALHOU|Error|falhou/i.test(l)).slice(0, 6) })
    })
  })
}

// ── FILA ────────────────────────────────────────────────────────────────────
console.log(`▶ suíte "${SUITE}": ${rodar.length} arquivo(s) · ${WORKERS} worker(s) · timeout ${TIMEOUT_S}s/arquivo`)
const t0 = Date.now()
const fila = [...rodar]
const resultados = []
await Promise.all(bancos.map(async (banco) => {
  while (fila.length) {
    const arq = fila.shift()
    const r = await rodarUm(arq, banco)
    resultados.push(r)
    console.log(`${r.status === 'PASSOU' ? '✅' : '❌'} ${r.status.padEnd(7)} ${r.seg.toFixed(1).padStart(6)}s  ${r.arq}`)
    if (r.status !== 'PASSOU') for (const l of r.cauda) console.log(`      ${l.slice(0, 200)}`)
  }
}))

// ── RELATÓRIO ───────────────────────────────────────────────────────────────
const total = (Date.now() - t0) / 1000
const falhos = resultados.filter((r) => r.status !== 'PASSOU')
console.log(`\n══ RESUMO — suíte "${SUITE}" ══`)
console.log(`rodados: ${resultados.length} · passaram: ${resultados.length - falhos.length} · falharam: ${falhos.length} · tempo: ${total.toFixed(0)}s`)
if (isolados.length) {
  console.log(`\nISOLADOS (não rodam no gate — motivo escrito no próprio arquivo):`)
  for (const i of isolados) console.log(`  · ${i.a}: ${i.motivo}`)
}
const lentos = [...resultados].sort((a, b) => b.seg - a.seg).slice(0, 5)
console.log(`\nmais lentos: ${lentos.map((r) => `${r.arq.replace('scripts/', '')} ${r.seg.toFixed(0)}s`).join(' · ')}`)
if (opt('json', '')) writeFileSync(opt('json', ''), JSON.stringify({ suite: SUITE, total, resultados, isolados }, null, 2))

for (const b of bancos) { try { await psql(`DROP DATABASE IF EXISTS "${b}" WITH (FORCE)`) } catch { /* ignora */ } }
if (falhos.length) {
  console.log(`\n⛔ ${falhos.length} arquivo(s) FALHARAM — o deploy NÃO sai:`)
  for (const f of falhos) console.log(`   ${f.status} ${f.arq}`)
  process.exit(1)
}
console.log('\n✅ suíte verde')
