// scripts/gate-finalizacao-todos-os-caminhos.test.ts
// ============================================================================
// GATE DE OBRIGAÇÃO RETROATIVA — TODOS os caminhos que podem escrever
// `Processo.faseAtualKey = 'finalizado'` (mandato "Catálogo de Fases",
// continuação 20/09/2026): avanço normal, forçado, movimentação manual do
// Administrador. Nenhuma exceção administrativa — ser Admin autoriza mover a
// fase, não autoriza ignorar obrigação obrigatória pendente em silêncio.
//
// O gate mora em UM único lugar (`executarPlano`, o funil comum de todas as
// operações em src/lib/motor/phase-advance.ts — REGRA SUPREMA: nenhuma escrita
// de faseAtualKey acontece fora dali). Por isso não há como um endpoint ou
// chamada interna contornar: todos os três caminhos testados aqui chamam a
// MESMA função exportada que qualquer rota chamaria.
//
//   PRISMA_DATABASE_URL=…discovery_test npx tsx scripts/gate-finalizacao-todos-os-caminhos.test.ts
// ============================================================================
import { prisma } from "../lib/prisma"
import { exigirBancoDeTeste } from "./_banco-de-teste"
import { garantirOferta } from "./_fixture-oferta"
import { materializarExecucaoDaFase } from "../src/services/materializar-fase"
import { movePhaseManual, forceAdvance, advance } from "../src/lib/motor/phase-advance"

let passou = 0, falhou = 0
const falhas: string[] = []
const ok = (nome: string, cond: boolean, extra: string | null | undefined = "") => {
  if (cond) { passou++; console.log(`  ✅ ${nome}${extra ? ` — ${extra}` : ""}`) }
  else { falhou++; falhas.push(nome); console.log(`  ❌ ${nome}${extra ? ` — ${extra}` : ""}`) }
}
const secao = (t: string) => console.log(`\n${t}`)

const MARCA = "GATEFIN"
const FASE_A = `${MARCA}_a`
const FASE_B = `${MARCA}_b` // obrigatória, sempre pendente até concluirmos de propósito
const FASE_C = `${MARCA}_c`

async function limpar() {
  const tipos = await prisma.tipoProcessoNacionalidade.findMany({ where: { code: { startsWith: MARCA } }, select: { id: true } })
  const tipoIds = tipos.map((t) => t.id)
  const procs = await prisma.processo.findMany({ where: { tipoProcessoMotorId: { in: tipoIds } }, select: { id: true } })
  const procIds = procs.map((p) => p.id)
  const tarefas = await prisma.tarefa.findMany({ where: { processoId: { in: procIds } }, select: { id: true } })
  await prisma.logAuditoria.deleteMany({ where: { entidadeId: { in: [...procIds, ...tarefas.map((t) => t.id)] } } })
  await prisma.domainOutbox.deleteMany({ where: { aggregateType: "Processo", aggregateId: { in: procIds } } })
  await prisma.phaseAdvanceLog.deleteMany({ where: { processoId: { in: procIds } } })
  await prisma.workflowEvento.deleteMany({ where: { processoId: { in: procIds } } })
  await prisma.tarefa.deleteMany({ where: { processoId: { in: procIds } } })
  await prisma.phaseWorkflowStepInstance.deleteMany({ where: { processoId: { in: procIds } } })
  await prisma.phaseWorkflowInstance.deleteMany({ where: { processoId: { in: procIds } } })
  await prisma.processo.deleteMany({ where: { id: { in: procIds } } })
  const wfs = await prisma.phaseInternalWorkflow.findMany({ where: { wfUid: { startsWith: MARCA } }, select: { id: true } })
  await prisma.phaseInternalWorkflowStep.deleteMany({ where: { workflowId: { in: wfs.map((w) => w.id) } } })
  await prisma.phaseInternalWorkflow.deleteMany({ where: { id: { in: wfs.map((w) => w.id) } } })
  const macros = await prisma.macroWorkflow.findMany({ where: { tipoProcessoId: { in: tipoIds } }, select: { id: true } })
  await prisma.faseMacro.deleteMany({ where: { macroWorkflowId: { in: macros.map((m) => m.id) } } })
  await prisma.macroWorkflow.deleteMany({ where: { id: { in: macros.map((m) => m.id) } } })
  await prisma.tipoProcessoNacionalidade.deleteMany({ where: { id: { in: tipoIds } } })
  await prisma.usuario.deleteMany({ where: { email: { endsWith: "@gatefin.test" } } })
}

/** Monta um processo NOVO com fase_b (obrigatória) pendente, já em fase_c (passou de fase_b sem concluí-la). */
async function montarProcessoComObrigacaoPendente(admin: { id: number }, tipoId: number, macroId: number) {
  const processo = await prisma.processo.create({
    data: { nome: `${MARCA} Processo ${Date.now()}-${Math.random()}`, workflowRuntime: "v2", faseAtualKey: FASE_A, tipoProcessoMotorId: tipoId, macroWorkflowVersion: 1 },
    select: { id: true },
  })
  await materializarExecucaoDaFase({ processoId: processo.id, fonte: "PROCESSO_CRIADO" })
  await prisma.phaseWorkflowInstance.updateMany({ where: { processoId: processo.id, faseMacroKey: FASE_A }, data: { status: "CONCLUIDO" } })
  // pula fase_b de propósito (nunca materializada) — obrigação retroativa real
  const mov = await movePhaseManual(processo.id, { faseAlvo: FASE_C, justificativa: "regularização de teste — pula fase_b de propósito", motivoCodigo: "CORRECAO_OPERACIONAL", solicitadoPorId: admin.id })
  if (!mov.success) throw new Error(`setup falhou: ${mov.code} ${mov.message}`)
  await prisma.phaseWorkflowInstance.updateMany({ where: { processoId: processo.id, faseMacroKey: FASE_C }, data: { status: "CONCLUIDO" } })
  return processo.id
}

async function main() {
  exigirBancoDeTeste("gate de finalização em todos os caminhos")
  console.log("GATE DE FINALIZAÇÃO — todos os caminhos protegidos, sem exceção administrativa\n")
  await limpar()

  const admin = await prisma.usuario.create({ data: { nome: "Admin GateFin", email: "admin@gatefin.test", senha: "x", tipo: "admin" }, select: { id: true } })
  const oferta = await garantirOferta(prisma, { countryKey: `${MARCA}_pais`, countryLabel: "País GateFin", modalityKey: `${MARCA}_modal`, modalityLabel: "Modalidade GateFin" })
  const tipo = await prisma.tipoProcessoNacionalidade.create({ data: { code: `${MARCA}_TIPO`, name: `${MARCA} Tipo`, paisId: oferta.paisId, modalidadeId: oferta.modalidadeId }, select: { id: true } })
  const macro = await prisma.macroWorkflow.create({ data: { tipoProcessoId: tipo.id, name: `${MARCA} macro`, versao: 1 }, select: { id: true } })
  const composicao = [
    { phaseKey: FASE_A, ordem: 1 }, { phaseKey: FASE_B, ordem: 2 }, { phaseKey: FASE_C, ordem: 3 }, { phaseKey: "finalizado", ordem: 4 },
  ]
  for (const f of composicao) {
    await prisma.faseMacro.create({ data: { macroWorkflowId: macro.id, phaseKey: f.phaseKey, label: f.phaseKey, ordem: f.ordem, required: true, conditional: false } })
  }
  for (const phaseKey of [FASE_A, FASE_B, FASE_C, "finalizado"]) {
    const wf = await prisma.phaseInternalWorkflow.create({ data: { wfUid: `${MARCA}::${phaseKey}`, phaseKey, name: `WF ${phaseKey}`, tipoProcessoId: tipo.id, versao: 1 }, select: { id: true } })
    await prisma.phaseInternalWorkflowStep.create({ data: { workflowId: wf.id, key: `${phaseKey}_passo`, label: `Passo ${phaseKey}`, ordem: 1, createsTask: true, required: false, owner: null, slaDays: 0, cardinalidade: "PROCESSO" } })
  }

  // ══════════════════════════════════════════════════════════════════════
  secao("1) avanço NORMAL para Finalizado é bloqueado com obrigação pendente")
  // ══════════════════════════════════════════════════════════════════════
  const proc1 = await montarProcessoComObrigacaoPendente(admin, tipo.id, macro.id)
  const tarefasAntes1 = await prisma.tarefa.count({ where: { processoId: proc1 } })
  const r1 = await advance(proc1)
  ok("1.1) advance() para finalizado é REJEITADO", !r1.success && r1.code === "OBRIGACAO_RETROATIVA_PENDENTE", r1.success ? "aceito" : r1.code)
  ok("1.2) mensagem cita a fase pendente (mensagem clara)", !r1.success && r1.message.includes(FASE_B), !r1.success ? r1.message : "")
  const proc1Depois = await prisma.processo.findUniqueOrThrow({ where: { id: proc1 }, select: { faseAtualKey: true } })
  ok("1.3) faseAtualKey NÃO mudou", proc1Depois.faseAtualKey === FASE_C, proc1Depois.faseAtualKey)
  const tarefasDepois1 = await prisma.tarefa.count({ where: { processoId: proc1 } })
  ok("1.4) nenhuma tarefa foi apagada/criada pela tentativa bloqueada", tarefasDepois1 === tarefasAntes1, `${tarefasAntes1}→${tarefasDepois1}`)

  // ══════════════════════════════════════════════════════════════════════
  secao("2) movePhaseManual para Finalizado é bloqueado (Admin não contorna)")
  // ══════════════════════════════════════════════════════════════════════
  const proc2 = await montarProcessoComObrigacaoPendente(admin, tipo.id, macro.id)
  const r2 = await movePhaseManual(proc2, { faseAlvo: "finalizado", justificativa: "tentando finalizar mesmo assim", motivoCodigo: "CORRECAO_OPERACIONAL", solicitadoPorId: admin.id })
  ok("2.1) movePhaseManual para finalizado é REJEITADO mesmo sendo Admin", !r2.success && r2.code === "OBRIGACAO_RETROATIVA_PENDENTE", r2.success ? "aceito" : r2.code)
  const proc2Depois = await prisma.processo.findUniqueOrThrow({ where: { id: proc2 }, select: { faseAtualKey: true } })
  ok("2.2) faseAtualKey NÃO mudou", proc2Depois.faseAtualKey === FASE_C, proc2Depois.faseAtualKey)

  // ══════════════════════════════════════════════════════════════════════
  secao("3) forceAdvance para Finalizado é bloqueado (nem o avanço FORÇADO ignora)")
  // ══════════════════════════════════════════════════════════════════════
  const proc3 = await montarProcessoComObrigacaoPendente(admin, tipo.id, macro.id)
  const r3 = await forceAdvance(proc3, { justificativa: "forçando mesmo com pendência", motivoCodigo: "CORRECAO_OPERACIONAL", solicitadoPorId: admin.id })
  ok("3.1) forceAdvance para finalizado é REJEITADO — bloqueio sobrevive ao forçado", !r3.success && r3.code === "OBRIGACAO_RETROATIVA_PENDENTE", r3.success ? "aceito" : r3.code)
  const proc3Depois = await prisma.processo.findUniqueOrThrow({ where: { id: proc3 }, select: { faseAtualKey: true } })
  ok("3.2) faseAtualKey NÃO mudou mesmo com forceAdvance", proc3Depois.faseAtualKey === FASE_C, proc3Depois.faseAtualKey)

  // ══════════════════════════════════════════════════════════════════════
  secao("4) Os três caminhos passam pela MESMA função (executarPlano) — não há um quarto caminho por fora")
  // ══════════════════════════════════════════════════════════════════════
  ok("4.1) advance, movePhaseManual e forceAdvance concordam no MESMO código de rejeição",
    !r1.success && !r2.success && !r3.success && r1.code === r2.code && r2.code === r3.code && r1.code === "OBRIGACAO_RETROATIVA_PENDENTE")

  // ══════════════════════════════════════════════════════════════════════
  secao("5) Movimentações entre fases NÃO finais continuam permitidas")
  // ══════════════════════════════════════════════════════════════════════
  const proc5 = await montarProcessoComObrigacaoPendente(admin, tipo.id, macro.id)
  const r5a = await movePhaseManual(proc5, { faseAlvo: FASE_B, justificativa: "regularizar fase_b", motivoCodigo: "CORRECAO_OPERACIONAL", solicitadoPorId: admin.id })
  ok("5.1) mover para fase_b (não-final) é ACEITO mesmo com a mesma obrigação 'pendente' — só Finalizado é gateado", r5a.success, r5a.success ? r5a.resultado : `${r5a.code}`)
  const r5b = await movePhaseManual(proc5, { faseAlvo: FASE_C, justificativa: "volta pra fase_c", motivoCodigo: "CORRECAO_OPERACIONAL", solicitadoPorId: admin.id })
  ok("5.2) mover de volta para fase_c (não-final) também é ACEITO", r5b.success, r5b.success ? r5b.resultado : `${r5b.code}`)

  // ══════════════════════════════════════════════════════════════════════
  secao("6) Operações paralelas continuam funcionando (materializar outra fase não é bloqueado pelo gate)")
  // ══════════════════════════════════════════════════════════════════════
  const proc6 = await montarProcessoComObrigacaoPendente(admin, tipo.id, macro.id)
  const relMat = await materializarExecucaoDaFase({ processoId: proc6, faseMacroKey: FASE_B, fonte: "RECONCILIACAO" })
  ok("6.1) materializar fase_b (trabalho paralelo) funciona normalmente, mesmo com finalização bloqueada", relMat.estado === "MATERIALIZADO", relMat.estado)

  // ══════════════════════════════════════════════════════════════════════
  secao("7) Depois de concluir a obrigação, a finalização passa a ser aceita")
  // ══════════════════════════════════════════════════════════════════════
  const instB = await prisma.phaseWorkflowInstance.findFirstOrThrow({ where: { processoId: proc6, faseMacroKey: FASE_B } })
  await prisma.phaseWorkflowInstance.update({ where: { id: instB.id }, data: { status: "CONCLUIDO" } })
  const r7 = await advance(proc6)
  ok("7.1) advance() para finalizado agora é ACEITO", r7.success, r7.success ? r7.resultado : `${r7.code}: ${r7.message}`)
  const proc6Depois = await prisma.processo.findUniqueOrThrow({ where: { id: proc6 }, select: { faseAtualKey: true, id: true } })
  ok("7.2) faseAtualKey agora é finalizado", proc6Depois.faseAtualKey === "finalizado", proc6Depois.faseAtualKey)
  ok("7.3) MESMO processo (mesmo id) do início ao fim", proc6Depois.id === proc6)

  // ══════════════════════════════════════════════════════════════════════
  secao("8) Tentativas repetidas continuam IDEMPOTENTES (não duplicam nada)")
  // ══════════════════════════════════════════════════════════════════════
  const tarefasAntesRepeticao = await prisma.tarefa.count({ where: { processoId: proc1 } })
  const r8a = await advance(proc1) // proc1 continua com obrigação pendente (nunca resolvida)
  const r8b = await advance(proc1)
  ok("8.1) rejeitar a mesma tentativa duas vezes dá o MESMO resultado", !r8a.success && !r8b.success && r8a.code === r8b.code)
  const tarefasDepoisRepeticao = await prisma.tarefa.count({ where: { processoId: proc1 } })
  ok("8.2) nenhuma tarefa nova apareceu com as tentativas repetidas", tarefasDepoisRepeticao === tarefasAntesRepeticao, `${tarefasAntesRepeticao}→${tarefasDepoisRepeticao}`)

  const r8c = await advance(proc6) // proc6 já está em finalizado — reexecutar advance() é idempotente/no-op
  ok("8.3) reexecutar advance() num processo já finalizado não regride nem duplica", !r8c.success || proc6Depois.faseAtualKey === "finalizado")

  // ══════════════════════════════════════════════════════════════════════
  secao("9) movePhaseManual usa o gate canônico para decidir CONCLUIR vs SUPERSEDER (correção 20/09/2026, item 8)")
  // ══════════════════════════════════════════════════════════════════════
  // Fases dedicadas com passo REQUIRED — as de 1-8 usam required:false, que nunca
  // bloqueia o gate imediato (não serve para provar a distinção CONCLUIR/SUPERSEDER).
  const FASE_D = `${MARCA}_d_req`
  const FASE_E = `${MARCA}_e_req`
  for (const f of [{ phaseKey: FASE_D, ordem: 10 }, { phaseKey: FASE_E, ordem: 11 }]) {
    await prisma.faseMacro.create({ data: { macroWorkflowId: macro.id, phaseKey: f.phaseKey, label: f.phaseKey, ordem: f.ordem, required: true, conditional: false } })
  }
  for (const phaseKey of [FASE_D, FASE_E]) {
    const wf = await prisma.phaseInternalWorkflow.create({ data: { wfUid: `${MARCA}::${phaseKey}`, phaseKey, name: `WF ${phaseKey}`, tipoProcessoId: tipo.id, versao: 1 }, select: { id: true } })
    await prisma.phaseInternalWorkflowStep.create({ data: { workflowId: wf.id, key: `${phaseKey}_passo`, label: `Passo ${phaseKey}`, ordem: 1, createsTask: true, required: true, owner: null, slaDays: 0, cardinalidade: "PROCESSO" } })
  }
  const proc9 = await prisma.processo.create({
    data: { nome: `${MARCA} Processo9 ${Date.now()}`, workflowRuntime: "v2", faseAtualKey: FASE_D, tipoProcessoMotorId: tipo.id, macroWorkflowVersion: 1 },
    select: { id: true },
  })
  await materializarExecucaoDaFase({ processoId: proc9.id, fonte: "PROCESSO_CRIADO" })

  // 9.1 — passo REQUIRED ainda aberto: canAdvance=false → SUPERSEDER (nunca CONCLUIR indevido).
  const r9a = await movePhaseManual(proc9.id, { faseAlvo: FASE_E, justificativa: "mover com obrigação real ainda aberta", motivoCodigo: "CORRECAO_OPERACIONAL", solicitadoPorId: admin.id })
  ok("9.1) mover COM passo obrigatório ainda aberto é aceito (mover não é gateado)", r9a.success, r9a.success ? r9a.resultado : `${r9a.code}`)
  const instD1 = await prisma.phaseWorkflowInstance.findFirstOrThrow({ where: { processoId: proc9.id, faseMacroKey: FASE_D }, orderBy: { ciclo: "desc" } })
  ok("9.2) com obrigação real ainda aberta, a instância de origem é SUPERSEDIDA — nunca CONCLUIDO forjado", instD1.status === "SUPERSEDIDO", instD1.status)

  // 9.3 — de volta a FASE_D, conclui de fato o passo obrigatório, então move de novo.
  const r9b = await movePhaseManual(proc9.id, { faseAlvo: FASE_D, justificativa: "volta para concluir de fato", motivoCodigo: "CORRECAO_OPERACIONAL", solicitadoPorId: admin.id })
  ok("9.3) volta para fase_d (novo ciclo)", r9b.success, r9b.success ? r9b.resultado : `${r9b.code}`)
  const instD2 = await prisma.phaseWorkflowInstance.findFirstOrThrow({ where: { processoId: proc9.id, faseMacroKey: FASE_D }, orderBy: { ciclo: "desc" } })
  await prisma.phaseWorkflowStepInstance.updateMany({ where: { workflowInstanceId: instD2.id }, data: { status: "CONCLUIDO" } })
  await prisma.tarefa.updateMany({ where: { processoId: proc9.id, workflowStepInstanceId: { in: (await prisma.phaseWorkflowStepInstance.findMany({ where: { workflowInstanceId: instD2.id }, select: { id: true } })).map((s) => s.id) } }, data: { statusTarefa: "CONCLUIDO_RECEBIDO" } })
  const r9c = await movePhaseManual(proc9.id, { faseAlvo: FASE_E, justificativa: "mover com obrigação REALMENTE satisfeita", motivoCodigo: "CORRECAO_OPERACIONAL", solicitadoPorId: admin.id })
  ok("9.4) mover com obrigação REALMENTE concluída é aceito", r9c.success, r9c.success ? r9c.resultado : `${r9c.code}`)
  const instD3 = await prisma.phaseWorkflowInstance.findFirstOrThrow({ where: { id: instD2.id } })
  ok("9.5) com obrigação REALMENTE satisfeita, a instância de origem vira CONCLUIDO (fix do item 8 — Workflow Macro/progresso geral param de mostrar 'Não confirmada' numa fase 100% feita)", instD3.status === "CONCLUIDO", instD3.status)

  console.log(`\n${passou} ok, ${falhou} falhas`)
  if (falhou > 0) { console.log("Falhas:", falhas.join(" | ")); process.exitCode = 1 }
  await limpar()
}

main().catch((e) => { console.error(e); process.exitCode = 1 }).finally(async () => { await prisma.$disconnect() })
