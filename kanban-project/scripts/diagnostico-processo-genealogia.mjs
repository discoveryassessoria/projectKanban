#!/usr/bin/env node
// scripts/diagnostico-processo-genealogia.mjs
// ============================================================================
// DIAGNÓSTICO SOMENTE LEITURA de um processo na Genealogia: por que ele avançou (ou não) de fase?
//
//   read -s DIAG_DATABASE_URL; export DIAG_DATABASE_URL     # cola a URL de produção e Enter (nada aparece)
//   node scripts/diagnostico-processo-genealogia.mjs 688
//   unset DIAG_DATABASE_URL
//
// Garantias: a URL só vem da variável (argumento com URL é recusado) e NUNCA é impressa (só host e banco); tudo roda numa
// transação `READ ONLY` — o Postgres recusa qualquer escrita; só SELECT; NÃO imprime nomes de pessoas nem senhas: só ids, flags,
// status, origens e datas. O argumento é o número do processo.
// ============================================================================
import pg from 'pg'

const URL_BRUTA = process.env.DIAG_DATABASE_URL ?? ''
const limpar = (t) => {
  let s = String(t)
  if (URL_BRUTA) s = s.split(URL_BRUTA).join('«url»')
  try { const senha = decodeURIComponent(new URL(URL_BRUTA).password); if (senha) s = s.split(senha).join('«senha»') } catch { /* já recusada */ }
  return s
}
const abortar = (m) => { console.error(`⛔ ${limpar(m)}`); process.exit(1) }

const args = process.argv.slice(2)
if (args.some((a) => /^[a-z]+:\/\//i.test(a) || /postgres/i.test(a))) abortar('Não passe a URL como argumento. Use a variável DIAG_DATABASE_URL.')
if (args.length !== 1 || !/^\d+$/.test(args[0])) abortar('Uso: node scripts/diagnostico-processo-genealogia.mjs <número do processo>')
const PROCESSO = Number(args[0])
if (!URL_BRUTA) abortar('Defina DIAG_DATABASE_URL (use `read -s DIAG_DATABASE_URL; export DIAG_DATABASE_URL`).')
let alvo
try { alvo = new URL(URL_BRUTA) } catch { abortar('DIAG_DATABASE_URL não é uma URL válida.') }
if (!/^postgres(ql)?:$/.test(alvo.protocol)) abortar('A URL precisa ser postgresql://.')
const local = /^(localhost|127\.0\.0\.1|::1)$/.test(alvo.hostname)

const c = new pg.Client({ connectionString: URL_BRUTA, connectionTimeoutMillis: 30000, ssl: local ? false : { rejectUnauthorized: false } })
const trunca = (v, n = 150) => (v == null ? v : String(v).replace(/\s+/g, ' ').slice(0, n))
const tabela = (titulo, linhas) => { console.log(`\n=== ${titulo} (${linhas.length})`); if (linhas.length) console.table(linhas) }

try {
  await c.connect()
  await c.query('BEGIN READ ONLY')
  console.log(`Alvo: ${alvo.hostname} / banco "${decodeURIComponent(alvo.pathname.replace(/^\//, ''))}" · processo ${PROCESSO} · SOMENTE LEITURA`)

  const proc = (await c.query(`SELECT id, "faseAtualKey", "arvoreId", "tipoProcessoMotorId", "dataConclusao" FROM "Processo" WHERE id = $1`, [PROCESSO])).rows
  tabela('Processo', proc)
  if (!proc.length) abortar(`Processo ${PROCESSO} não encontrado.`)
  const arvoreId = proc[0].arvoreId

  // `documentosExigidos` só existe depois da migration 20261002100000; num banco mais antigo o script não quebra.
  const temLista = (await c.query(`SELECT 1 FROM information_schema.columns WHERE table_name = 'Pessoa' AND column_name = 'documentosExigidos'`)).rowCount > 0
  const pessoas = arvoreId == null ? [] : (await c.query(
    `SELECT id, vivo, casado, "linhaReta", requerente, documentacao, ${temLista ? '"documentosExigidos"' : 'NULL::json AS "documentosExigidos"'} FROM "Pessoa" WHERE "arvoreId" = $1 ORDER BY id`, [arvoreId])).rows
  tabela('Pessoas da árvore (sem nomes): flags e a lista de certidões escolhida (null = regra automática)', pessoas.map((p) => ({ ...p, documentosExigidos: JSON.stringify(p.documentosExigidos) })))

  const necs = (await c.query(
    `SELECT id, "pessoaId", "uniaoId", origem, status, "dispensaManual", "supersedePorId", "varianteKey", "createdAt"
       FROM "NecessidadeDocumental" WHERE "processoId" = $1 ORDER BY id`, [PROCESSO])).rows
  tabela('Necessidades documentais (status != DISPENSADA e sem supersede = "viva" para a trava)', necs.map((n) => ({ ...n, varianteKey: trunca(n.varianteKey, 40) })))
  const vivas = necs.filter((n) => n.supersedePorId == null && n.status !== 'DISPENSADA').length
  console.log(`\n→ necessidades VIVAS (condição 3 da trava "zero por escolha manual"): ${vivas}`)

  const avancos = (await c.query(`SELECT * FROM "PhaseAdvanceLog" WHERE "processoId" = $1 ORDER BY id DESC LIMIT 8`, [PROCESSO])).rows
  tabela('Últimos avanços de fase (origem = quem chamou; resultado)', avancos.map((a) => {
    const o = {}
    for (const [k, v] of Object.entries(a)) o[k] = v instanceof Date ? v.toISOString() : (typeof v === 'object' && v !== null ? trunca(JSON.stringify(v), 90) : trunca(v, 90))
    return o
  }))

  const ids = pessoas.map((p) => p.id), nids = necs.map((n) => n.id)
  const logs = (await c.query(
    `SELECT id, acao, entidade, "entidadeId", "usuarioId", "criadoEm", descricao FROM "LogAuditoria"
      WHERE ("entidade" = 'Pessoa' AND "entidadeId" = ANY($1::int[]))
         OR ("entidade" = 'Processo' AND "entidadeId" = $2)
         OR ("entidade" = 'NecessidadeDocumental' AND "entidadeId" = ANY($3::int[]))
      ORDER BY id DESC LIMIT 40`, [ids, PROCESSO, nids])).rows
  tabela('Auditoria recente (pessoas, processo e necessidades)', logs.map((l) => ({ ...l, criadoEm: l.criadoEm.toISOString(), descricao: trunca(l.descricao, 150) })))

  await c.query('ROLLBACK')
  console.log('\nFim. Nada foi escrito (transação somente leitura).')
} catch (e) {
  abortar(`Falhou: ${e.message}`)
} finally {
  await c.end().catch(() => {})
}
