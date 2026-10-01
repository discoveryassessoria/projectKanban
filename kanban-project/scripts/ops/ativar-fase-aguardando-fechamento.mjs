#!/usr/bin/env node
// scripts/ops/ativar-fase-aguardando-fechamento.mjs
// ============================================================================
// PREPARA O DADO DA FASE "AGUARDANDO FECHAMENTO" (phaseKey `a_iniciar`) — INERTE até ser rodado de propósito, por uma pessoa.
//
// O QUE FAZ (PASSO A PASSO):
//   1. CATÁLOGO DE FASES (`CatalogoFase`) — sempre:
//        • `a_iniciar`: cria a linha se não existir; senão ajusta SÓ o que difere: rótulo "Aguardando fechamento", ordemPadrao 0,
//          ativa/PUBLICADA, escopo PROCESSO, requiredPadrao=false, conditionalPadrao=false. Nunca duplica (phaseKey é único).
//        • as 10 fases do enum: ajusta SÓ a `ordemPadrao` para a sequência real do trabalho = `FASES[...].ordem + 1` (Genealogia 1 …
//          Finalizado 10) — derivada do catálogo em código (fonte única), nunca lista escrita aqui. Rótulo e ativo NÃO são tocados.
//        • fase fora das 10 + a_iniciar (teste, legado…): LISTADA e deixada INTACTA. Fase do enum ausente: relatada, NÃO criada.
//        • cada mudança grava a MESMA trilha da API (revisão congelada em `CatalogoFaseRevisao` + `LogAuditoria`, quem = script/sistema).
//   2. WORKFLOW MACRO (`--com-macros`, OPCIONAL, desligado por padrão) — acrescenta `a_iniciar` como FaseMacro de MENOR ordem
//        (required=false, conditional=false) nos MacroWorkflow ativos que ainda não a têm; incrementa `versao`, congela
//        `MacroWorkflowVersao` e audita, como a publicação pela tela faz. NÃO enfileira nada: a reconciliação retroativa só existe para
//        fase `required && !conditional` (`enqueueReconciliacaoFaseMacro`); `proximaFaseDoCaminho` ignora `required`; o gate de
//        obrigação retroativa só olha fase obrigatória — provado em scripts/fase-aguardando-fechamento-motor.test.ts e
//        scripts/ativar-fase-aguardando-fechamento.test.ts. Macro cuja menor ordem é < 1 é PULADO (relatado), nunca renumerado.
//   3. Tudo numa TRANSAÇÃO ÚNICA (tudo ou nada), conferida por releitura antes do COMMIT e de novo depois (zero diferença do plano).
//
// NÃO FAZ: não migra schema, não toca processo/tarefa/passo, não materializa nada, não lê `.env`, não imprime a URL.
//
// COMO USAR (a URL só existe na variável de ambiente do seu terminal, nunca em argumento). Precisa do tsx (lê FASES do código):
//   read -s ATIVAR_FASE_DATABASE_URL; export ATIVAR_FASE_DATABASE_URL
//   npx tsx scripts/ops/ativar-fase-aguardando-fechamento.mjs                       # SIMULAÇÃO: mostra o plano, não escreve
//   CONFIRMO_ESCRITA_EM_PRODUCAO=SIM npx tsx scripts/ops/ativar-fase-aguardando-fechamento.mjs --confirmo-escrever
//   CONFIRMO_ESCRITA_EM_PRODUCAO=SIM CONFIRMO_CODIGO_NO_AR=SIM npx tsx scripts/ops/ativar-fase-aguardando-fechamento.mjs --confirmo-escrever --com-macros
//   unset ATIVAR_FASE_DATABASE_URL
//
// TRAVAS (qualquer uma aborta antes de escrever): URL em argumento; variável ausente/URL inválida; tabelas esperadas ausentes;
// escrita sem AS DUAS confirmações (`--confirmo-escrever` + CONFIRMO_ESCRITA_EM_PRODUCAO=SIM); `--com-macros` sem
// CONFIRMO_CODIGO_NO_AR=SIM (a trava de avanço manual e o filtro da Torre precisam estar NO AR antes de qualquer processo entrar em a_iniciar).
// ============================================================================
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const pg = require('pg')

const ARGS = process.argv.slice(2)
const ESCREVER = ARGS.includes('--confirmo-escrever')
const COM_MACROS = ARGS.includes('--com-macros')
const URL_BRUTA = process.env.ATIVAR_FASE_DATABASE_URL ?? ''

function limpar(texto) {
  let t = String(texto)
  if (URL_BRUTA) t = t.split(URL_BRUTA).join('«url»')
  try { const senha = decodeURIComponent(new URL(URL_BRUTA).password); if (senha) t = t.split(senha).join('«senha»') } catch { /* já recusada */ }
  return t
}
const abortar = (msg) => { console.error(`⛔ ${limpar(msg)}`); console.error('Nada foi escrito.'); process.exit(1) }

// ── 1) entradas ────────────────────────────────────────────────────────────
if (ARGS.some((a) => /^[a-z]+:\/\//i.test(a) || /postgres/i.test(a))) abortar('Não passe a URL como argumento (ficaria no histórico). Use a variável ATIVAR_FASE_DATABASE_URL.')
const desconhecidos = ARGS.filter((a) => !['--confirmo-escrever', '--com-macros'].includes(a))
if (desconhecidos.length) abortar(`Argumento desconhecido: ${desconhecidos.join(' ')}`)
if (!URL_BRUTA) abortar('Defina ATIVAR_FASE_DATABASE_URL (use `read -s ATIVAR_FASE_DATABASE_URL`).')
let alvo
try { alvo = new URL(URL_BRUTA) } catch { abortar('ATIVAR_FASE_DATABASE_URL não é uma URL válida.') }
if (!/^postgres(ql)?:$/.test(alvo.protocol)) abortar('A URL precisa ser postgresql://.')
const HOST = alvo.hostname.toLowerCase()
const BANCO = decodeURIComponent(alvo.pathname.replace(/^\//, '')) || '(sem nome)'
if (ESCREVER && process.env.CONFIRMO_ESCRITA_EM_PRODUCAO !== 'SIM') abortar('Escrever exige AS DUAS confirmações: --confirmo-escrever E a variável CONFIRMO_ESCRITA_EM_PRODUCAO=SIM.')
if (ESCREVER && COM_MACROS && process.env.CONFIRMO_CODIGO_NO_AR !== 'SIM') abortar('--com-macros exige CONFIRMO_CODIGO_NO_AR=SIM: a trava de avanço manual e o filtro "fora da Torre" precisam estar no ar ANTES de qualquer processo entrar em a_iniciar.')

// ── 2) a fonte única das fases (código) ─────────────────────────────────────
let FASES, PHASEKEY_A_INICIAR, ROTULO, ORDEM_PADRAO_AI
try {
  ({ FASES } = await import('../../src/lib/process-stage/fases-catalog.ts'))
  ;({ PHASEKEY_A_INICIAR, ROTULO_AGUARDANDO_FECHAMENTO: ROTULO, ORDEM_PADRAO_AGUARDANDO_FECHAMENTO: ORDEM_PADRAO_AI } = await import('../../src/lib/process-stage/fase-pre-contrato.ts'))
} catch (e) { abortar(`Não consegui ler o catálogo em código (rode com \`npx tsx\`): ${e.message}`) }

const ALVO_ENUM = new Map(Object.values(FASES).map((f) => [f.phaseKey, f.ordem + 1]))   // Genealogia 1 … Finalizado 10
const ALVO_AI = { label: ROTULO, ordemPadrao: ORDEM_PADRAO_AI, ativo: true, status: 'PUBLICADA', escopo: 'PROCESSO', requiredPadrao: false, conditionalPadrao: false }

console.log(`Alvo: ${HOST} / banco "${BANCO}"`)
console.log(ESCREVER ? `Modo: ESCREVER (--confirmo-escrever${COM_MACROS ? ' --com-macros' : ''})` : 'Modo: SIMULAÇÃO (nenhuma escrita)')

// ── 3) leitura ─────────────────────────────────────────────────────────────
const TABELAS = ['CatalogoFase', 'CatalogoFaseRevisao', 'LogAuditoria', 'MacroWorkflow', 'FaseMacro', 'MacroWorkflowVersao']
const c = new pg.Client({ connectionString: URL_BRUTA, connectionTimeoutMillis: 20000 })
try { await c.connect() } catch (e) { abortar(`Não consegui conectar: ${e.message}`) }

async function lerEstado(db) {
  const catalogo = (await db.query(`SELECT id, "phaseKey", label, "ordemPadrao", ativo, status::text AS status, escopo::text AS escopo, "requiredPadrao", "conditionalPadrao", "efeitosPermitidos", "revisaoAtual" FROM "CatalogoFase" ORDER BY id`)).rows
  const macros = (await db.query(`SELECT m.id, m.name, m.ativo, m.versao, m."tipoProcessoId", m."modalidadeId", m."cardinalidadeRequerimento",
      (SELECT json_agg(json_build_object('phaseKey', f."phaseKey", 'label', f.label, 'ordem', f.ordem, 'required', f.required, 'conditional', f.conditional,
          'showInKanban', f."showInKanban", 'entryRule', f."entryRule") ORDER BY f.ordem, f.id) FROM "FaseMacro" f WHERE f."macroWorkflowId" = m.id) AS fases
      FROM "MacroWorkflow" m ORDER BY m.id`)).rows.map((m) => ({ ...m, fases: m.fases ?? [] }))
  return { catalogo, macros }
}

try {
  const t = (await c.query(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = ANY($1)`, [TABELAS])).rows.map((r) => r.table_name)
  const faltam = TABELAS.filter((x) => !t.includes(x))
  if (faltam.length) abortar(`O banco não tem as tabelas esperadas (faltam: ${faltam.join(', ')}). Recuso — não é o banco do sistema.`)
} catch (e) { abortar(`Não consegui ler o banco: ${e.message}`) }

const estado = await lerEstado(c)

// ── 4) o PLANO ─────────────────────────────────────────────────────────────
const porChave = new Map(estado.catalogo.map((r) => [r.phaseKey, r]))
const planoCatalogo = []   // { phaseKey, acao: 'CRIAR'|'AJUSTAR'|'OK'|'AUSENTE', mudancas: {campo:[de,para]} }
{
  const ai = porChave.get(PHASEKEY_A_INICIAR)
  if (!ai) planoCatalogo.push({ phaseKey: PHASEKEY_A_INICIAR, acao: 'CRIAR', linha: null, mudancas: Object.fromEntries(Object.entries(ALVO_AI).map(([k, v]) => [k, [null, v]])) })
  else {
    const m = {}
    for (const [k, v] of Object.entries(ALVO_AI)) if (ai[k] !== v) m[k] = [ai[k], v]
    planoCatalogo.push({ phaseKey: PHASEKEY_A_INICIAR, acao: Object.keys(m).length ? 'AJUSTAR' : 'OK', linha: ai, mudancas: m })
  }
  for (const [phaseKey, ordem] of ALVO_ENUM) {
    const r = porChave.get(phaseKey)
    if (!r) { planoCatalogo.push({ phaseKey, acao: 'AUSENTE', linha: null, mudancas: {} }); continue }
    const m = r.ordemPadrao !== ordem ? { ordemPadrao: [r.ordemPadrao, ordem] } : {}
    planoCatalogo.push({ phaseKey, acao: Object.keys(m).length ? 'AJUSTAR' : 'OK', linha: r, mudancas: m })
  }
}
const intactas = estado.catalogo.filter((r) => r.phaseKey !== PHASEKEY_A_INICIAR && !ALVO_ENUM.has(r.phaseKey))

const planoMacros = estado.macros.filter((m) => m.ativo).map((m) => {
  const tem = m.fases.find((f) => f.phaseKey === PHASEKEY_A_INICIAR)
  if (tem) return { macro: m, acao: 'OK', motivo: tem.required === false && tem.conditional === false ? 'já tem a_iniciar' : `já tem a_iniciar (required=${tem.required}, conditional=${tem.conditional} — não alterado)` }
  if (!m.fases.length) return { macro: m, acao: 'PULAR', motivo: 'macro sem fases' }
  const min = Math.min(...m.fases.map((f) => f.ordem))
  if (min < 1) return { macro: m, acao: 'PULAR', motivo: `menor ordem é ${min} (<1): não há ordem anterior sem renumerar — resolva pela tela` }
  return { macro: m, acao: 'INCLUIR', ordem: min - 1, primeira: m.fases.find((f) => f.ordem === min), motivo: `entra com ordem ${min - 1}` }
})

const mostrar = (v) => (v === null || v === undefined ? '∅' : String(v))
console.log('\nPLANO — Catálogo de Fases')
console.log('  phaseKey                         ação      rótulo (atual → alvo)             ordemPadrao   ativo')
for (const p of planoCatalogo) {
  const r = p.linha
  const lab = p.phaseKey === PHASEKEY_A_INICIAR ? `${mostrar(r?.label)} → ${ROTULO}` : `${mostrar(r?.label)} (inalterado)`
  const ordem = p.mudancas.ordemPadrao ? `${mostrar(p.mudancas.ordemPadrao[0])} → ${p.mudancas.ordemPadrao[1]}` : mostrar(r?.ordemPadrao ?? (p.phaseKey === PHASEKEY_A_INICIAR ? ORDEM_PADRAO_AI : ''))
  const ativo = p.phaseKey === PHASEKEY_A_INICIAR ? `${mostrar(r?.ativo)} → true` : `${mostrar(r?.ativo)} (inalterado)`
  console.log(`  ${p.phaseKey.padEnd(32)} ${p.acao.padEnd(9)} ${lab.padEnd(34)} ${ordem.padEnd(13)} ${ativo}`)
  if (p.phaseKey === PHASEKEY_A_INICIAR) for (const [k, [de, para]] of Object.entries(p.mudancas)) if (!['label', 'ordemPadrao', 'ativo'].includes(k)) console.log(`      · ${k}: ${mostrar(de)} → ${mostrar(para)}`)
}
console.log(`\n  Fases FORA das 10 do enum + a_iniciar (INTACTAS): ${intactas.length ? intactas.map((r) => `${r.phaseKey} (ordem ${r.ordemPadrao}, ${r.ativo ? 'ativa' : 'inativa'})`).join('; ') : 'nenhuma'}`)
const ausentes = planoCatalogo.filter((p) => p.acao === 'AUSENTE')
if (ausentes.length) console.log(`  ⚠ Fases do enum AUSENTES no cadastro (NÃO criadas por este script): ${ausentes.map((p) => p.phaseKey).join(', ')}`)

console.log(`\nPLANO — Workflow Macro ${COM_MACROS ? '(--com-macros: SERÁ aplicado)' : '(somente leitura: passo OPCIONAL, desligado — use --com-macros)'}`)
for (const p of planoMacros) console.log(`  macro #${p.macro.id} "${p.macro.name}" v${p.macro.versao}: ${p.acao} — ${p.motivo}`)
if (!planoMacros.length) console.log('  nenhum Workflow Macro ativo')

const catalogoAfazer = planoCatalogo.filter((p) => p.acao === 'CRIAR' || p.acao === 'AJUSTAR')
const macrosAfazer = COM_MACROS ? planoMacros.filter((p) => p.acao === 'INCLUIR') : []
if (!catalogoAfazer.length && !macrosAfazer.length) {
  console.log('\nNada a fazer: o dado já está como o plano pede. Nada foi escrito.')
  await c.end(); process.exit(0)
}
console.log(`\nEscreveria: ${catalogoAfazer.length} linha(s) do catálogo${COM_MACROS ? ` e ${macrosAfazer.length} macro(s)` : ''}.`)
if (!ESCREVER) {
  console.log('\nSimulação concluída. Nada foi escrito. Para escrever: CONFIRMO_ESCRITA_EM_PRODUCAO=SIM … --confirmo-escrever [--com-macros]')
  await c.end(); process.exit(0)
}

// ── 5) ESCREVER — transação única ──────────────────────────────────────────
const QUEM = 'script ativar-fase-aguardando-fechamento (sem usuário)'
const RELEVANTES = ['label', 'escopo', 'ordemPadrao', 'requiredPadrao', 'conditionalPadrao', 'status']

async function escrever(db) {
  await db.query(`SELECT pg_advisory_xact_lock(hashtext('ativar-fase-aguardando-fechamento'))`)
  const relido = await lerEstado(db)   // dentro do lock: o plano vale para o estado que vamos de fato alterar
  const ref = JSON.stringify(estado.catalogo.map((r) => [r.phaseKey, r.label, r.ordemPadrao, r.ativo, r.status]))
  if (ref !== JSON.stringify(relido.catalogo.map((r) => [r.phaseKey, r.label, r.ordemPadrao, r.ativo, r.status]))) throw new Error('o catálogo mudou entre o plano e a escrita — rode de novo')

  for (const p of catalogoAfazer) {
    const m = p.mudancas
    if (p.acao === 'CRIAR') {
      const r = (await db.query(
        `INSERT INTO "CatalogoFase" ("phaseKey", label, descricao, escopo, "ordemPadrao", "requiredPadrao", "conditionalPadrao", ativo, status, "efeitosPermitidos", "revisaoAtual", "atualizadoEm")
         VALUES ($1,$2,$3,$4::"EscopoExecucao",$5,$6,$7,true,'PUBLICADA'::"CatalogoFaseStatus",'[]'::jsonb,1,now()) RETURNING id`,
        [PHASEKEY_A_INICIAR, ROTULO, 'Pré-trabalho: o processo espera o fechamento do contrato e só sai por decisão humana. Não gera certidão nem tarefa.', ALVO_AI.escopo, ORDEM_PADRAO_AI, false, false])).rows[0]
      await db.query(
        `INSERT INTO "CatalogoFaseRevisao" ("catalogoFaseId", revisao, "phaseKey", label, descricao, escopo, "ordemPadrao", "requiredPadrao", "conditionalPadrao", status, "efeitosPermitidos", "congeladoPorId", origem)
         SELECT id, 1, "phaseKey", label, descricao, escopo, "ordemPadrao", "requiredPadrao", "conditionalPadrao", status, "efeitosPermitidos", NULL, 'CRIACAO' FROM "CatalogoFase" WHERE id = $1`, [r.id])
      await db.query(`INSERT INTO "LogAuditoria" (acao, entidade, "entidadeId", descricao, detalhes, "usuarioId") VALUES ('PHASE_CREATED','CatalogoFase',$1,$2,$3::jsonb,NULL)`,
        [r.id, `Fase "${ROTULO}" (chave ${PHASEKEY_A_INICIAR}) criada e publicada por ${QUEM}: pré-trabalho, primeira da sequência (ordem ${ORDEM_PADRAO_AI}).`, JSON.stringify({ depois: ALVO_AI, motivo: 'ativação da fase Aguardando fechamento', quem: QUEM })])
      continue
    }
    const l = p.linha
    const sets = [], vals = []
    const set = (col, v, cast = '') => { vals.push(v); sets.push(`"${col}" = $${vals.length}${cast}`) }
    if (m.label) set('label', m.label[1])
    if (m.ordemPadrao) set('ordemPadrao', m.ordemPadrao[1])
    if (m.ativo) set('ativo', m.ativo[1])
    if (m.status) set('status', m.status[1], '::"CatalogoFaseStatus"')
    if (m.escopo) set('escopo', m.escopo[1], '::"EscopoExecucao"')
    if (m.requiredPadrao) set('requiredPadrao', m.requiredPadrao[1])
    if (m.conditionalPadrao) set('conditionalPadrao', m.conditionalPadrao[1])
    const mudouRelevante = RELEVANTES.some((k) => m[k])
    const revisaoNova = l.revisaoAtual + (mudouRelevante ? 1 : 0)
    if (mudouRelevante) set('revisaoAtual', revisaoNova)
    vals.push(l.id)
    await db.query(`UPDATE "CatalogoFase" SET ${sets.join(', ')}, "atualizadoEm" = now() WHERE id = $${vals.length}`, vals)
    if (mudouRelevante) {
      await db.query(
        `INSERT INTO "CatalogoFaseRevisao" ("catalogoFaseId", revisao, "phaseKey", label, descricao, escopo, "ordemPadrao", "requiredPadrao", "conditionalPadrao", status, "efeitosPermitidos", "congeladoPorId", origem)
         SELECT id, $2, "phaseKey", label, descricao, escopo, "ordemPadrao", "requiredPadrao", "conditionalPadrao", status, "efeitosPermitidos", NULL, 'PUBLICACAO' FROM "CatalogoFase" WHERE id = $1`, [l.id, revisaoNova])
    }
    const ativou = m.ativo && m.ativo[1] === true
    const resumo = Object.entries(m).map(([k, [de, para]]) => `${k}: ${mostrar(de)} → ${mostrar(para)}`).join('; ')
    await db.query(`INSERT INTO "LogAuditoria" (acao, entidade, "entidadeId", descricao, detalhes, "usuarioId") VALUES ($1,'CatalogoFase',$2,$3,$4::jsonb,NULL)`,
      [ativou ? 'PHASE_ACTIVATED' : 'PHASE_UPDATED', l.id,
        `Fase "${m.label ? m.label[1] : l.label}" (chave ${l.phaseKey}, imutável) alterada por ${QUEM}${mudouRelevante ? `, revisão ${revisaoNova}` : ''} — ${resumo}. Motivo: alinhar a ordem à sequência real do trabalho / ativar "Aguardando fechamento".`,
        JSON.stringify({ antes: l, mudancas: m, revisao: revisaoNova, quem: QUEM })])
  }

  for (const p of macrosAfazer) {
    const m = p.macro
    const versaoNova = m.versao + 1
    await db.query(
      `INSERT INTO "FaseMacro" ("macroWorkflowId", "phaseKey", label, ordem, required, conditional, "entryRule", "exitRule", "showInKanban", "atualizadoEm")
       VALUES ($1,$2,$3,$4,false,false,'process_created',NULL,true,now())`, [m.id, PHASEKEY_A_INICIAR, ROTULO, p.ordem])
    // a antiga primeira deixa de ser a entrada do processo (a tela deriva entryRule da posição)
    await db.query(`UPDATE "FaseMacro" SET "entryRule" = 'previous_phase_completed', "atualizadoEm" = now() WHERE "macroWorkflowId" = $1 AND "phaseKey" <> $2 AND "entryRule" = 'process_created'`, [m.id, PHASEKEY_A_INICIAR])
    await db.query(`UPDATE "MacroWorkflow" SET versao = $2, "atualizadoEm" = now() WHERE id = $1`, [m.id, versaoNova])
    const fasesFinais = (await db.query(`SELECT "phaseKey", label, ordem, required, conditional, "showInKanban", "entryRule" FROM "FaseMacro" WHERE "macroWorkflowId" = $1 ORDER BY ordem, id`, [m.id])).rows
    await db.query(`INSERT INTO "MacroWorkflowVersao" ("macroWorkflowId", versao, "tipoProcessoId", "modalidadeId", "cardinalidadeRequerimento", name, fases, "congeladoPorId", origem) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,NULL,'PUBLICACAO')`,
      [m.id, versaoNova, m.tipoProcessoId, m.modalidadeId, m.cardinalidadeRequerimento, m.name, JSON.stringify(fasesFinais)])
    await db.query(`INSERT INTO "LogAuditoria" (acao, entidade, "entidadeId", descricao, detalhes, "usuarioId") VALUES ('WORKFLOW_PHASE_ADDED','MacroWorkflow',$1,$2,$3::jsonb,NULL)`,
      [m.id, `1 fase(s) adicionada(s) ao fluxo "${m.name}": ${PHASEKEY_A_INICIAR} (primeira, ordem ${p.ordem}, não obrigatória) por ${QUEM}. Nenhuma reconciliação retroativa (fase não obrigatória).`,
        JSON.stringify({ adicionadas: [PHASEKEY_A_INICIAR], versaoAnterior: m.versao, versaoNova, quem: QUEM })])
  }
}

/** Confere o que está gravado contra o plano. Devolve a lista de divergências (vazia = zero diferença). */
function conferir(est) {
  const dif = []
  const por = new Map(est.catalogo.map((r) => [r.phaseKey, r]))
  const ai = por.get(PHASEKEY_A_INICIAR)
  if (!ai) dif.push('a_iniciar ausente no catálogo')
  else for (const [k, v] of Object.entries(ALVO_AI)) if (ai[k] !== v) dif.push(`a_iniciar.${k} = ${ai[k]} (esperado ${v})`)
  for (const [phaseKey, ordem] of ALVO_ENUM) { const r = por.get(phaseKey); if (r && r.ordemPadrao !== ordem) dif.push(`${phaseKey}.ordemPadrao = ${r.ordemPadrao} (esperado ${ordem})`) }
  if (est.catalogo.filter((r) => r.phaseKey === PHASEKEY_A_INICIAR).length > 1) dif.push('a_iniciar duplicada')
  if (COM_MACROS) for (const m of est.macros.filter((x) => x.ativo)) {
    const orig = planoMacros.find((p) => p.macro.id === m.id)
    if (orig?.acao === 'INCLUIR') {
      const f = m.fases.find((x) => x.phaseKey === PHASEKEY_A_INICIAR)
      if (!f || f.required !== false || f.conditional !== false || f.ordem !== orig.ordem) dif.push(`macro #${m.id}: a_iniciar ausente/incorreta`)
      if (m.fases[0]?.phaseKey !== PHASEKEY_A_INICIAR) dif.push(`macro #${m.id}: a_iniciar não é a primeira`)
      if (m.versao !== orig.macro.versao + 1) dif.push(`macro #${m.id}: versão ${m.versao} (esperado ${orig.macro.versao + 1})`)
    }
  }
  return dif
}

try {
  await c.query('BEGIN')
  await escrever(c)
  const dentro = conferir(await lerEstado(c))
  if (dentro.length) throw new Error(`conferência dentro da transação falhou: ${dentro.join('; ')}`)
  await c.query('COMMIT')
  console.log('\n✔ Transação confirmada (COMMIT).')
} catch (e) {
  await c.query('ROLLBACK').catch(() => null)
  await c.end().catch(() => null)
  abortar(`Falhou e foi DESFEITO (ROLLBACK, nada ficou gravado): ${e.message}`)
}
await c.end()

// releitura com conexão NOVA — zero diferença do plano
const c2 = new pg.Client({ connectionString: URL_BRUTA, connectionTimeoutMillis: 20000 })
await c2.connect()
const dif = conferir(await lerEstado(c2))
await c2.end()
if (dif.length) { console.error(`⛔ RELEITURA DIVERGE DO PLANO: ${limpar(dif.join('; '))}`); process.exit(2) }
console.log('✔ Releitura confere: zero diferença em relação ao plano.')
console.log(`Gravado: ${catalogoAfazer.length} linha(s) do catálogo${COM_MACROS ? ` e ${macrosAfazer.length} macro(s)` : ''}. Rode de novo em simulação: deve dizer "Nada a fazer".`)
