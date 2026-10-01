// scripts/ativar-fase-aguardando-fechamento.test.ts
// ============================================================================
// O SCRIPT INERTE scripts/ops/ativar-fase-aguardando-fechamento.mjs, testado contra o banco EFÊMERO (nunca produção).
//
//   (a) estado de PRODUÇÃO reproduzido: a_iniciar ativa ordem 1 + ordens fora de sequência + Tradução em 11;
//   (b) banco sem a linha a_iniciar; (c) já correto = nada a fazer; (d) execução repetida = idempotente;
//   (e) simulação não escreve nada; (f) falha no meio = ROLLBACK; (g) --com-macros: a_iniciar de menor ordem SEM reconciliação
//   retroativa e SEM mexer em processo; criarProcessoV2 depois dele nasce em a_iniciar; (h) travas de segurança.
// ============================================================================
import { exigirBancoDeTeste } from "./_banco-de-teste"
exigirBancoDeTeste("ativar-fase-aguardando-fechamento.test.ts")

import { spawnSync } from "child_process"
import { join } from "path"
const pg = require("pg") as { Client: new (o: { connectionString: string }) => { connect(): Promise<void>; query(q: string): Promise<unknown>; end(): Promise<void> } }
import { prisma } from "../lib/prisma"
import { garantirOferta } from "./_fixture-oferta"
import { criarProcessoV2 } from "../src/services/criar-processo"
import { FASES } from "../src/lib/process-stage/fases-catalog"
import { PHASEKEY_A_INICIAR, ROTULO_AGUARDANDO_FECHAMENTO } from "../src/lib/process-stage/fase-pre-contrato"

let passou = 0, falhou = 0
const falhas: string[] = []
const ok = (n: string, c: boolean, extra = "") => { if (c) { passou++; console.log(`  ✅ ${n}${extra ? ` — ${extra}` : ""}`) } else { falhou++; falhas.push(n); console.log(`  ❌ ${n}${extra ? ` — ${extra}` : ""}`) } }
const secao = (t: string) => console.log(`\n${t}`)

const RAIZ = join(__dirname, "..")
const URL_TESTE = process.env.PRISMA_DATABASE_URL || process.env.DATABASE_URL || ""
const SCRIPT = "scripts/ops/ativar-fase-aguardando-fechamento.mjs"
const MARCA = "ATVFASE"

function rodar(args: string[], env: Record<string, string> = {}, url: string | null = URL_TESTE) {
  const r = spawnSync(join(RAIZ, "node_modules/.bin/tsx"), [SCRIPT, ...args], {
    cwd: RAIZ, encoding: "utf8", timeout: 120_000,
    env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", ...(url ? { ATIVAR_FASE_DATABASE_URL: url } : {}), ...env } as unknown as NodeJS.ProcessEnv,
  })
  return { status: r.status, out: `${r.stdout}\n${r.stderr}` }
}
const ESCREVE = { CONFIRMO_ESCRITA_EM_PRODUCAO: "SIM" }

const ORDEM_REAL = Object.fromEntries(Object.values(FASES).map((f) => [f.phaseKey, f.ordem + 1]))
const ORDEM_PROD: Record<string, number> = {
  emissao_documental: 2, analise_documental: 3, genealogia: 4, retificacao_registros: 5, emissao_documental_retificada: 6,
  apostilamento: 7, aguardando_protocolo: 8, protocolado: 9, finalizado: 10, traducao_juramentada: 11,
}

const snapshot = async () => JSON.stringify({
  catalogo: (await prisma.catalogoFase.findMany({ orderBy: { id: "asc" }, select: { id: true, phaseKey: true, label: true, ordemPadrao: true, ativo: true, status: true, escopo: true, requiredPadrao: true, conditionalPadrao: true, revisaoAtual: true } })),
  revisoes: await prisma.catalogoFaseRevisao.count(), logs: await prisma.logAuditoria.count(), fasesMacro: await prisma.faseMacro.count(), versoes: await prisma.macroWorkflowVersao.count(),
})

async function estadoProducao() {
  await prisma.catalogoFase.deleteMany({ where: { phaseKey: { in: [PHASEKEY_A_INICIAR, "teste_fase_legado"] } } })
  for (const [k, ordem] of Object.entries(ORDEM_PROD)) await prisma.catalogoFase.update({ where: { phaseKey: k }, data: { ordemPadrao: ordem } })
  await prisma.catalogoFase.create({ data: { phaseKey: PHASEKEY_A_INICIAR, label: ROTULO_AGUARDANDO_FECHAMENTO, ordemPadrao: 1, ativo: true, status: "PUBLICADA", escopo: "PROCESSO", requiredPadrao: true, efeitosPermitidos: [] } })
  await prisma.catalogoFase.create({ data: { phaseKey: "teste_fase_legado", label: "Fase de teste legada", ordemPadrao: 77, ativo: false, status: "INATIVA", escopo: "PROCESSO", efeitosPermitidos: [] } })
}

async function limparMacros() {
  const tipos = await prisma.tipoProcessoNacionalidade.findMany({ where: { code: { startsWith: MARCA } }, select: { id: true } })
  const ids = tipos.map((t) => t.id)
  const procs = await prisma.processo.findMany({ where: { tipoProcessoMotorId: { in: ids } }, select: { id: true } })
  const pids = procs.map((p) => p.id)
  await prisma.domainOutbox.deleteMany({ where: { aggregateType: "Processo", aggregateId: { in: pids } } })
  await prisma.phaseAdvanceLog.deleteMany({ where: { processoId: { in: pids } } })
  await prisma.workflowEvento.deleteMany({ where: { processoId: { in: pids } } })
  await prisma.tarefa.deleteMany({ where: { processoId: { in: pids } } })
  await prisma.phaseWorkflowStepInstance.deleteMany({ where: { processoId: { in: pids } } })
  await prisma.phaseWorkflowInstance.deleteMany({ where: { processoId: { in: pids } } })
  await prisma.processo.deleteMany({ where: { id: { in: pids } } })
  const macros = await prisma.macroWorkflow.findMany({ where: { tipoProcessoId: { in: ids } }, select: { id: true } })
  await prisma.macroWorkflowVersao.deleteMany({ where: { macroWorkflowId: { in: macros.map((m) => m.id) } } })
  await prisma.faseMacro.deleteMany({ where: { macroWorkflowId: { in: macros.map((m) => m.id) } } })
  await prisma.macroWorkflow.deleteMany({ where: { id: { in: macros.map((m) => m.id) } } })
  await prisma.tipoProcessoModalidadeHabilitada.deleteMany({ where: { tipoProcessoId: { in: ids } } })
  await prisma.tipoProcessoNacionalidade.deleteMany({ where: { id: { in: ids } } })
}

async function main() {
  const u = new URL(URL_TESTE)
  secao("(h) Travas de segurança — nada é escrito")
  const antesH = await snapshot()
  const arg = rodar([URL_TESTE])
  ok("URL em ARGUMENTO é recusada", arg.status === 1 && /argumento/i.test(arg.out) && !arg.out.includes(u.host + u.pathname))
  const semUrl = rodar([], {}, null)
  ok("sem a variável: recusa", semUrl.status === 1 && /ATIVAR_FASE_DATABASE_URL/.test(semUrl.out))
  const semConf = rodar(["--confirmo-escrever"])
  ok("--confirmo-escrever SEM CONFIRMO_ESCRITA_EM_PRODUCAO=SIM: recusa (duas confirmações)", semConf.status === 1 && /DUAS confirmações/.test(semConf.out))
  const semNoAr = rodar(["--confirmo-escrever", "--com-macros"], ESCREVE)
  ok("--com-macros SEM CONFIRMO_CODIGO_NO_AR=SIM: recusa", semNoAr.status === 1 && /CONFIRMO_CODIGO_NO_AR/.test(semNoAr.out))
  ok("argumento desconhecido: recusa", rodar(["--qualquer"]).status === 1)
  const admin = new pg.Client({ connectionString: `${u.protocol}//${u.username}${u.password ? ":" + u.password : ""}@${u.host}/postgres` })
  await admin.connect()
  await admin.query(`DROP DATABASE IF EXISTS atvfase_test_vazio`)
  await admin.query(`CREATE DATABASE atvfase_test_vazio`)
  const urlVazio = `${u.protocol}//${u.username}${u.password ? ":" + u.password : ""}@${u.host}/atvfase_test_vazio`
  const vazio = rodar([], {}, urlVazio)
  ok("banco SEM as tabelas esperadas: recusa", vazio.status === 1 && /tabelas esperadas/.test(vazio.out))
  await admin.query(`DROP DATABASE IF EXISTS atvfase_test_vazio`)
  await admin.end()
  ok("a identidade do alvo (host/banco) é impressa e a URL/senha NUNCA", /Alvo: .* \/ banco "/.test(rodar([]).out) && !rodar([]).out.includes(URL_TESTE))
  ok("as recusas não escreveram nada", (await snapshot()) === antesH)

  secao("(a) Estado de PRODUÇÃO reproduzido: a_iniciar ativa ordem 1, ordens fora de sequência, Tradução em 11")
  await estadoProducao()
  const semArv = await snapshot()
  const sim = rodar([])
  ok("(e) SIMULAÇÃO: mostra o plano linha a linha e NÃO escreve nada", sim.status === 0 && /PLANO — Catálogo de Fases/.test(sim.out) && /Simulação concluída/.test(sim.out) && (await snapshot()) === semArv, sim.out.split("\n").filter((l) => /traducao|genealogia|a_iniciar/.test(l)).slice(0, 3).join(" | "))
  ok("o plano mostra ordemPadrao atual → alvo (Genealogia 4 → 1; Tradução 11 → 6) e a fase legada INTACTA", /genealogia\s+AJUSTAR.*4 → 1/.test(sim.out) && /traducao_juramentada\s+AJUSTAR.*11 → 6/.test(sim.out) && /teste_fase_legado \(ordem 77, inativa\)/.test(sim.out))
  const logsAntes = await prisma.logAuditoria.count()
  const w1 = rodar(["--confirmo-escrever"], ESCREVE)
  ok("ESCRITA: sucesso, COMMIT e releitura sem diferença", w1.status === 0 && /COMMIT/.test(w1.out) && /zero diferença/.test(w1.out), w1.out.slice(-300))
  const cat = await prisma.catalogoFase.findMany({ select: { phaseKey: true, ordemPadrao: true, label: true, ativo: true, status: true, escopo: true, requiredPadrao: true, conditionalPadrao: true } })
  const por = new Map(cat.map((c) => [c.phaseKey, c]))
  ok("as 10 fases do enum seguem a sequência REAL derivada de FASES (Genealogia 1 … Finalizado 10)", Object.entries(ORDEM_REAL).every(([k, o]) => por.get(k)?.ordemPadrao === o), JSON.stringify(Object.entries(ORDEM_REAL).filter(([k, o]) => por.get(k)?.ordemPadrao !== o)))
  const ai = por.get(PHASEKEY_A_INICIAR)
  ok("a_iniciar: ordem 0 (antes de todas), rótulo oficial, ativa/PUBLICADA, escopo PROCESSO, não obrigatória", ai?.ordemPadrao === 0 && ai.label === ROTULO_AGUARDANDO_FECHAMENTO && ai.ativo && ai.status === "PUBLICADA" && ai.escopo === "PROCESSO" && ai.requiredPadrao === false && ai.conditionalPadrao === false)
  ok("só UMA linha a_iniciar (nunca duplica)", cat.filter((c) => c.phaseKey === PHASEKEY_A_INICIAR).length === 1)
  ok("a fase legada ficou INTACTA (ordem 77, inativa)", por.get("teste_fase_legado")?.ordemPadrao === 77 && por.get("teste_fase_legado")?.ativo === false)
  const ordemFinal = cat.filter((c) => c.phaseKey !== "teste_fase_legado").sort((x, y) => x.ordemPadrao - y.ordemPadrao).map((c) => c.phaseKey)
  ok("a ordem do cadastro: a_iniciar, genealogia, emissão, análise, retificação, emissão ret., tradução, apostilamento, ag. protocolo, protocolado, finalizado", ordemFinal.join(",") === [PHASEKEY_A_INICIAR, ...Object.values(FASES).sort((x, y) => x.ordem - y.ordem).map((f) => f.phaseKey)].join(","), ordemFinal.join(","))
  const gen = await prisma.catalogoFase.findUniqueOrThrow({ where: { phaseKey: "genealogia" }, select: { id: true, revisaoAtual: true } })
  const revGen = await prisma.catalogoFaseRevisao.findFirst({ where: { catalogoFaseId: gen.id, revisao: gen.revisaoAtual }, select: { ordemPadrao: true, origem: true } })
  ok("trilha: a mudança de ordem congelou REVISÃO nova (como a API) e gravou LogAuditoria 'sem usuário'", revGen?.ordemPadrao === 1 && revGen.origem === "PUBLICACAO" && gen.revisaoAtual >= 2 &&
    (await prisma.logAuditoria.count({ where: { acao: { in: ["PHASE_UPDATED", "PHASE_ACTIVATED"] }, entidade: "CatalogoFase", usuarioId: null, descricao: { contains: "script ativar-fase-aguardando-fechamento" } } })) >= 5 &&
    (await prisma.logAuditoria.count()) > logsAntes)
  const finalizado = await prisma.catalogoFase.findUniqueOrThrow({ where: { phaseKey: "finalizado" }, select: { revisaoAtual: true } })
  ok("a fase que JÁ estava certa (finalizado, 10) não ganhou revisão à toa", finalizado.revisaoAtual === 1)

  secao("(d) Execução repetida: idempotente")
  const apos = await snapshot()
  const w2 = rodar(["--confirmo-escrever"], ESCREVE)
  ok("de novo: 'Nada a fazer', exit 0, NADA escrito", w2.status === 0 && /Nada a fazer/.test(w2.out) && (await snapshot()) === apos)

  secao("(c) Já correto = nada a fazer (inclusive em simulação)")
  const c1 = rodar([])
  ok("simulação sobre o dado já correto também diz 'Nada a fazer'", c1.status === 0 && /Nada a fazer/.test(c1.out))

  secao("(b) Banco SEM a linha a_iniciar: cria (uma só), sem tocar nas demais")
  await prisma.catalogoFase.deleteMany({ where: { phaseKey: PHASEKEY_A_INICIAR } })
  const w3 = rodar(["--confirmo-escrever"], ESCREVE)
  const criada = await prisma.catalogoFase.findMany({ where: { phaseKey: PHASEKEY_A_INICIAR }, include: { revisoes: true } })
  ok("criou exatamente UMA linha a_iniciar, publicada, com revisão 1 (CRIACAO)", w3.status === 0 && criada.length === 1 && criada[0].status === "PUBLICADA" && criada[0].ordemPadrao === 0 && criada[0].revisoes.length === 1 && criada[0].revisoes[0].origem === "CRIACAO", w3.out.slice(-200))
  ok("e as fases do enum continuam na sequência real", (await prisma.catalogoFase.count({ where: { OR: Object.entries(ORDEM_REAL).map(([phaseKey, ordemPadrao]) => ({ phaseKey, ordemPadrao })) } })) === 10)

  secao("(a') Estado intermediário: a_iniciar INATIVA com rótulo 'A iniciar' e ordem 161 (como estava antes)")
  await prisma.catalogoFase.update({ where: { phaseKey: PHASEKEY_A_INICIAR }, data: { label: "A iniciar", ordemPadrao: 161, ativo: false, status: "INATIVA", requiredPadrao: true } })
  const w4 = rodar(["--confirmo-escrever"], ESCREVE)
  const ai4 = await prisma.catalogoFase.findUniqueOrThrow({ where: { phaseKey: PHASEKEY_A_INICIAR } })
  ok("corrige rótulo, ordem, ativação, status e required — e registra PHASE_ACTIVATED", w4.status === 0 && ai4.label === ROTULO_AGUARDANDO_FECHAMENTO && ai4.ordemPadrao === 0 && ai4.ativo && ai4.status === "PUBLICADA" && ai4.requiredPadrao === false &&
    (await prisma.logAuditoria.count({ where: { acao: "PHASE_ACTIVATED", entidadeId: ai4.id } })) >= 1)

  secao("(f) Falha no meio da escrita: ROLLBACK total")
  await prisma.catalogoFase.update({ where: { phaseKey: "genealogia" }, data: { ordemPadrao: 9 } })
  await prisma.catalogoFase.update({ where: { phaseKey: PHASEKEY_A_INICIAR }, data: { ordemPadrao: 5 } })
  const antesF = await snapshot()
  await prisma.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION atvfase_falha() RETURNS trigger AS $$ BEGIN IF NEW.acao IN ('PHASE_UPDATED','PHASE_ACTIVATED') AND NEW.descricao LIKE '%${"ativar-fase-aguardando-fechamento"}%' THEN RAISE EXCEPTION 'falha injetada pelo teste'; END IF; RETURN NEW; END $$ LANGUAGE plpgsql`)
  await prisma.$executeRawUnsafe(`CREATE TRIGGER atvfase_falha_t BEFORE INSERT ON "LogAuditoria" FOR EACH ROW EXECUTE FUNCTION atvfase_falha()`)
  const wf = rodar(["--confirmo-escrever"], ESCREVE)
  await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS atvfase_falha_t ON "LogAuditoria"`)
  await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS atvfase_falha()`)
  ok("a escrita FALHOU (exit ≠ 0) e foi desfeita", wf.status === 1 && /ROLLBACK/.test(wf.out) && /falha injetada/.test(wf.out), wf.out.slice(-200))
  ok("NADA ficou gravado (catálogo, revisões, logs idênticos ao de antes)", (await snapshot()) === antesF)
  const w5 = rodar(["--confirmo-escrever"], ESCREVE)
  ok("sem a falha, a mesma execução conclui (reexecução segura)", w5.status === 0 && (await prisma.catalogoFase.findUniqueOrThrow({ where: { phaseKey: "genealogia" } })).ordemPadrao === 1 && (await prisma.catalogoFase.findUniqueOrThrow({ where: { phaseKey: PHASEKEY_A_INICIAR } })).ordemPadrao === 0)

  secao("(g) --com-macros: a_iniciar de MENOR ordem, sem reconciliação retroativa, sem mexer em processo")
  await limparMacros()
  const oferta = await garantirOferta(prisma, { countryKey: `${MARCA}_PAIS`, countryLabel: "País AtvFase", modalityKey: "administrativa", modalityLabel: "Administrativa" })
  const pais = await prisma.catalogoPais.findUniqueOrThrow({ where: { id: oferta.paisId }, select: { countryKey: true } })
  const tipo = await prisma.tipoProcessoNacionalidade.create({ data: { code: `${MARCA}_T`, name: `${MARCA} T`, paisId: oferta.paisId }, select: { id: true } })
  await prisma.tipoProcessoModalidadeHabilitada.create({ data: { tipoProcessoId: tipo.id, modalidadeId: oferta.modalidadeId, ativo: true } })
  const macro = await prisma.macroWorkflow.create({ data: { tipoProcessoId: tipo.id, modalidadeId: oferta.modalidadeId, name: `${MARCA} macro`, versao: 3 }, select: { id: true } })
  await prisma.faseMacro.create({ data: { macroWorkflowId: macro.id, phaseKey: "genealogia", label: "Genealogia", ordem: 1, entryRule: "process_created" } })
  await prisma.faseMacro.create({ data: { macroWorkflowId: macro.id, phaseKey: "finalizado", label: "Finalizado", ordem: 2, entryRule: "previous_phase_completed" } })
  // macro "sem espaço": a menor ordem já é 0 → o script PULA e relata (nunca renumera)
  const tipoB = await prisma.tipoProcessoNacionalidade.create({ data: { code: `${MARCA}_B`, name: `${MARCA} B`, paisId: oferta.paisId }, select: { id: true } })
  const modB = await prisma.modalidadePais.upsert({ where: { paisId_modalityKey: { paisId: oferta.paisId, modalityKey: "judicial" } }, update: {}, create: { paisId: oferta.paisId, modalityKey: "judicial", modalityLabel: "Judicial" }, select: { id: true } })
  await prisma.tipoProcessoModalidadeHabilitada.create({ data: { tipoProcessoId: tipoB.id, modalidadeId: modB.id, ativo: true } })
  const macroB = await prisma.macroWorkflow.create({ data: { tipoProcessoId: tipoB.id, modalidadeId: modB.id, name: `${MARCA} macro B` }, select: { id: true } })
  await prisma.faseMacro.create({ data: { macroWorkflowId: macroB.id, phaseKey: "genealogia", label: "Genealogia", ordem: 0 } })
  await prisma.faseMacro.create({ data: { macroWorkflowId: macroB.id, phaseKey: "finalizado", label: "Finalizado", ordem: 1 } })
  const proc = await prisma.processo.create({ data: { nome: `${MARCA} em andamento`, workflowRuntime: "v2", faseAtualKey: "genealogia", tipoProcessoMotorId: tipo.id, modalidadeId: oferta.modalidadeId, macroWorkflowVersion: 3 }, select: { id: true } })
  const estadoProc = async () => JSON.stringify({ p: await prisma.processo.findUniqueOrThrow({ where: { id: proc.id }, select: { faseAtualKey: true, lockVersion: true, macroWorkflowVersion: true } }), t: await prisma.tarefa.count({ where: { processoId: proc.id } }), i: await prisma.phaseWorkflowInstance.count({ where: { processoId: proc.id } }), o: await prisma.domainOutbox.count({ where: { tipo: "fase.macro.reconciliar" } }) })
  const procAntes = await estadoProc()
  const semMacros = rodar(["--confirmo-escrever"], ESCREVE)
  ok("SEM --com-macros o script NÃO toca em macro algum (passo opcional, desligado)", semMacros.status === 0 && (await prisma.faseMacro.count({ where: { phaseKey: PHASEKEY_A_INICIAR } })) === 0 || /Nada a fazer/.test(semMacros.out))
  const simM = rodar(["--com-macros"])
  ok("a simulação com --com-macros mostra INCLUIR / PULAR por macro e não escreve", /macro #\d+ "ATVFASE macro" v3: INCLUIR/.test(simM.out) && /PULAR — menor ordem é 0/.test(simM.out) && (await prisma.faseMacro.count({ where: { phaseKey: PHASEKEY_A_INICIAR } })) === 0)
  const wm = rodar(["--confirmo-escrever", "--com-macros"], { ...ESCREVE, CONFIRMO_CODIGO_NO_AR: "SIM" })
  const fasesM = await prisma.faseMacro.findMany({ where: { macroWorkflowId: macro.id }, orderBy: { ordem: "asc" } })
  const mw = await prisma.macroWorkflow.findUniqueOrThrow({ where: { id: macro.id }, select: { versao: true } })
  ok("INCLUIU a_iniciar como a PRIMEIRA fase do macro (ordem 0), required=false, conditional=false", wm.status === 0 && fasesM[0]?.phaseKey === PHASEKEY_A_INICIAR && fasesM[0].ordem === 0 && !fasesM[0].required && !fasesM[0].conditional && fasesM.length === 3, wm.out.slice(-250))
  ok("a versão do macro subiu (3 → 4) e a revisão foi CONGELADA, como a publicação pela tela", mw.versao === 4 && (await prisma.macroWorkflowVersao.count({ where: { macroWorkflowId: macro.id, versao: 4, origem: "PUBLICACAO" } })) === 1)
  ok("a antiga primeira deixou de ser 'process_created' (derivado da posição)", fasesM.find((f) => f.phaseKey === "genealogia")?.entryRule === "previous_phase_completed" && fasesM[0].entryRule === "process_created")
  ok("o macro SEM espaço (ordem 0) foi PULADO e continua intacto", (await prisma.faseMacro.count({ where: { macroWorkflowId: macroB.id } })) === 2 && /PULAR/.test(wm.out))
  ok("NENHUMA reconciliação retroativa enfileirada e o processo em andamento ficou EXATAMENTE como estava", (await estadoProc()) === procAntes)
  ok("auditoria do macro (WORKFLOW_PHASE_ADDED, sem usuário)", (await prisma.logAuditoria.count({ where: { acao: "WORKFLOW_PHASE_ADDED", entidade: "MacroWorkflow", entidadeId: macro.id, usuarioId: null } })) === 1)
  const wm2 = rodar(["--confirmo-escrever", "--com-macros"], { ...ESCREVE, CONFIRMO_CODIGO_NO_AR: "SIM" })
  ok("repetir --com-macros: idempotente (versão continua 4, uma só a_iniciar)", wm2.status === 0 && (await prisma.macroWorkflow.findUniqueOrThrow({ where: { id: macro.id } })).versao === 4 && (await prisma.faseMacro.count({ where: { macroWorkflowId: macro.id, phaseKey: PHASEKEY_A_INICIAR } })) === 1)

  secao("Depois do script: processo NOVO nasce em a_iniciar, parado, sem tarefa")
  const novo = await criarProcessoV2({ nome: `${MARCA} novo`, pais: pais.countryKey, tipoProcessoMotorId: tipo.id, modalidadeId: oferta.modalidadeId })
  ok("criarProcessoV2 nasce em a_iniciar, sem tarefa, sem erro de workflow", novo.success && novo.currentPhaseKey === PHASEKEY_A_INICIAR && novo.tarefasIniciais === 0, novo.success ? "" : `${novo.code}: ${novo.message}`)
  ok("e o processo antigo continua intacto depois da criação", (await estadoProc()) === procAntes)

  await limparMacros()
  console.log(`\n${falhou === 0 ? "✅ PASSOU" : "❌ FALHOU"}: ${passou} ok, ${falhou} falhas`)
  if (falhou > 0) { console.log(falhas.join("\n")); process.exit(1) }
}
main().catch((e) => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
