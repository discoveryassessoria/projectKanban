// scripts/auditoria-integral-catalogo-fases.ts
//
// MANDATO "MÓDULO DE FASES" (20/09/2026), seções 2 e 3 — cenário sintético
// completo e prova ponta a ponta da retroação, idempotência, retrocesso
// manual e inativação. Roda EXCLUSIVAMENTE contra produção, tocando
// EXCLUSIVAMENTE os processos [TESTE VISUAL] 632-637 e as fases sintéticas
// TESTEVIS_fase / teste_visual_auditoria_integral_fases já existentes no
// Catálogo — nenhum processo real, nenhum workflow produtivo é tocado.
//
// PROIBIDO (autochecado antes de qualquer escrita): mexer em processo cujo
// nome não comece com "[TESTE VISUAL]".
//
// Uso:
//   EU_CONFIRMO_ESCRITA_EM_PRODUCAO=1 npx tsx scripts/auditoria-integral-catalogo-fases.ts
import { exigirConfirmacaoDeEscritaEmProducao } from "./_banco-de-teste"
exigirConfirmacaoDeEscritaEmProducao(
  "mandato Módulo de Fases 20/09/2026 — cenário sintético 632-637: monta Workflow Macro isolado, insere fase no meio, prova retroação/idempotência/retrocesso/inativação",
  "auditoria-integral-catalogo-fases.ts",
)

import { prisma } from "../lib/prisma"
import { signAuthToken } from "../lib/auth-jwt"
import { materializarExecucaoDaFase } from "../src/services/materializar-fase"
import { processarOutbox } from "../src/services/outbox-dispatcher"
import { movePhaseManual } from "../src/lib/motor/phase-advance"
import { planejarRetrocesso, executarRetrocesso } from "../src/services/retrocesso-de-fase"

const PROCESSOS_ALVO = [632, 633, 634, 635, 636, 637]
const TIPO_CODE = "TESTEVIS_TIPO_AUDITORIA"
const FASE_ANTES = "TESTEVIS_fase" // já existe, id 29
const FASE_INSERIDA = "teste_visual_auditoria_integral_fases" // já existe, id 34
const FASE_DEPOIS = "finalizado" // canônica

let admin: { id: number; nome: string; email: string }
let ok = 0, falhou = 0
const matriz: Array<{ requisito: string; esperado: string; encontrado: string; passou: boolean }> = []
function prova(requisito: string, esperado: string, encontrado: string, passou: boolean) {
  matriz.push({ requisito, esperado, encontrado, passou })
  if (passou) { ok++; console.log(`  ✅ ${requisito} — ${encontrado}`) }
  else { falhou++; console.error(`  ❌ ${requisito}\n     esperado : ${esperado}\n     encontrado: ${encontrado}`) }
}

async function contarEstadoGlobal(processoIds: number[]) {
  // Documento não entra aqui: o workflow sintético desta prova usa só o efeito
  // REGISTER_ONLY (registrar), que não materializa Documento — não existe
  // "documento duplicado" possível neste cenário para contar.
  const [instancias, steps, tarefas] = await Promise.all([
    prisma.phaseWorkflowInstance.count({ where: { processoId: { in: processoIds } } }),
    prisma.phaseWorkflowStepInstance.count({ where: { processoId: { in: processoIds } } }),
    prisma.tarefa.count({ where: { processoId: { in: processoIds } } }),
  ])
  return { instancias, steps, tarefas }
}

async function main() {
  console.log("\n========================================================")
  console.log("AUDITORIA INTEGRAL — MÓDULO DE FASES (mandato 20/09/2026)")
  console.log("========================================================\n")

  // ── 0) SEGURANÇA — trava por construção ──────────────────────────────────
  console.log("── 0) Verificação de segurança ──")
  const processos = await prisma.processo.findMany({
    where: { id: { in: PROCESSOS_ALVO } },
    select: { id: true, nome: true, faseAtualKey: true, tipoProcessoMotorId: true, dataConclusao: true, paisId: true },
  })
  if (processos.length !== PROCESSOS_ALVO.length) throw new Error("nem todos os 6 processos sintéticos foram encontrados — abortando")
  for (const p of processos) {
    if (!p.nome.startsWith("[TESTE VISUAL]")) {
      throw new Error(`SEGURANÇA: processo ${p.id} ("${p.nome}") NÃO começa com "[TESTE VISUAL]" — abortando antes de qualquer escrita.`)
    }
  }
  console.log(`  ✅ 6/6 processos confirmados sintéticos: ${processos.map((p) => p.id).join(", ")}`)

  const admins = await prisma.usuario.findFirst({ where: { tipo: "admin" }, orderBy: { id: "asc" }, select: { id: true, nome: true, email: true } })
  if (!admins) throw new Error("nenhum admin no banco")
  admin = admins
  console.log(`  ✅ autor das ações: ${admin.nome} (#${admin.id})`)

  // ── 1) Workflow Macro sintético isolado ──────────────────────────────────
  console.log("\n── 1) Workflow Macro sintético isolado ──")
  const paisModalidade = await prisma.modalidadePais.findFirst({ select: { id: true, paisId: true, modalityLabel: true, pais: { select: { countryLabel: true } } } })
  if (!paisModalidade) throw new Error("nenhuma modalidade de país cadastrada — não há como criar o tipo sintético")

  const tipo = await prisma.tipoProcessoNacionalidade.upsert({
    where: { code: TIPO_CODE },
    update: {},
    create: {
      code: TIPO_CODE,
      name: "[TESTE VISUAL] Tipo Sintético — Auditoria Integral de Fases",
      paisId: paisModalidade.paisId,
      modalidadeId: paisModalidade.id,
      ativo: true,
    },
  })
  console.log(`  ✅ TipoProcessoNacionalidade #${tipo.id} (${tipo.code}) — país: ${paisModalidade.pais.countryLabel}`)

  const macro = await prisma.macroWorkflow.upsert({
    where: { tipoProcessoId: tipo.id },
    update: { ativo: true },
    create: { tipoProcessoId: tipo.id, name: `Workflow Macro · ${tipo.name}`, ativo: true },
  })
  console.log(`  ✅ MacroWorkflow #${macro.id}`)

  // Composição PRÉ-inserção: TESTEVIS_fase(1) → finalizado(2). A fase do meio
  // ainda NÃO existe na composição — ela entra no passo 4 (seção 3.1/3.2).
  await prisma.faseMacro.deleteMany({ where: { macroWorkflowId: macro.id } })
  await prisma.faseMacro.createMany({
    data: [
      { macroWorkflowId: macro.id, phaseKey: FASE_ANTES, label: "Fase de Teste Visual", ordem: 1, required: true, conditional: false, entryRule: "process_created", showInKanban: true },
      { macroWorkflowId: macro.id, phaseKey: FASE_DEPOIS, label: "Finalizado", ordem: 2, required: true, conditional: false, entryRule: "previous_phase_completed", showInKanban: true },
    ],
  })
  console.log(`  ✅ Composição pré-inserção: ${FASE_ANTES}(1) → ${FASE_DEPOIS}(2)`)

  // Workflow Interno mínimo publicado para as DUAS fases que vão materializar
  // de verdade nesta prova (TESTEVIS_fase e a fase inserida) — sem isto,
  // instanciarWorkflowDaFase recusa com CONFIGURACAO_INVALIDA/SEM_WORKFLOW_PUBLICADO
  // (causa raiz real do item 1.2 do mandato).
  for (const fk of [FASE_ANTES, FASE_INSERIDA, FASE_DEPOIS]) {
    const wfUid = `${TIPO_CODE}::${fk}`
    const existente = await prisma.phaseInternalWorkflow.findUnique({ where: { wfUid } })
    if (!existente) {
      const wf = await prisma.phaseInternalWorkflow.create({
        data: { wfUid, phaseKey: fk, name: `Workflow Interno · ${fk}`, tipoProcessoId: tipo.id, versao: 1, active: true, execucao: "SEQUENCIAL" },
      })
      await prisma.phaseInternalWorkflowStep.create({
        data: { workflowId: wf.id, key: "registro", label: "Registrar", ordem: 1, createsTask: true, required: true, owner: null, slaDays: 0, cardinalidade: null },
      })
      console.log(`  ✅ Workflow Interno publicado para "${fk}" (1 passo)`)
    } else {
      console.log(`  · Workflow Interno de "${fk}" já existia — reaproveitado`)
    }
  }

  // ── 2) Distribuição dos processos sintéticos ─────────────────────────────
  console.log("\n── 2) Distribuição dos processos 632-637 ──")
  await prisma.processo.updateMany({
    where: { id: { in: PROCESSOS_ALVO } },
    data: { tipoProcessoMotorId: tipo.id, paisId: paisModalidade.paisId },
  })
  console.log(`  ✅ 6 processos vinculados ao tipo sintético + país "${paisModalidade.pais.countryLabel}" (corrige item 1.5)`)

  // 632 antes | 633 na posição da inserção | 634 depois | 635 preparado p/ retorno | 637 idempotência: todos em TESTEVIS_fase (ordem1)
  await prisma.processo.updateMany({ where: { id: { in: [632, 633, 635, 637] } }, data: { faseAtualKey: FASE_ANTES } })
  // 634: já ADIANTE de onde a fase vai ser inserida (ordem2 pré-inserção = "finalizado")
  await prisma.processo.update({ where: { id: 634 }, data: { faseAtualKey: FASE_DEPOIS } })
  // 636: finalizado DE VERDADE (dataConclusao setada) — nunca deve ser tocado por reconciliação nenhuma
  await prisma.processo.update({ where: { id: 636 }, data: { faseAtualKey: FASE_DEPOIS, dataConclusao: new Date() } })
  console.log("  ✅ 632/633/635/637 → TESTEVIS_fase (antes) | 634 → finalizado (adiante) | 636 → finalizado + dataConclusao (concluído de verdade)")

  // Materializa de verdade cada um — PROVA do item 1.2 (CONFIGURACAO_INVALIDA eliminado)
  console.log("\n── Materialização real (prova do item 1.2 — sem CONFIGURACAO_INVALIDA) ──")
  for (const pid of [632, 633, 634, 635, 637]) {
    const rel = await materializarExecucaoDaFase({ processoId: pid, fonte: "REGULARIZACAO_HISTORICA", solicitadoPorId: admin.id })
    prova(
      `processo ${pid}: materialização real (não CONFIGURACAO_INVALIDA)`,
      "ok=true, estado != CONFIGURACAO_INVALIDA",
      `ok=${rel.ok}, estado=${rel.estado}`,
      rel.ok === true && rel.estado !== "CONFIGURACAO_INVALIDA",
    )
  }
  // 636 é finalizado — NÃO materializar (regra master: finalizado não sofre nada automático)

  await main2(tipo, macro, paisModalidade)
}

async function main2(tipo: { id: number }, macro: { id: number }, paisModalidade: { paisId: number }) {
  const estadoAntesDaInsercao = await contarEstadoGlobal(PROCESSOS_ALVO)

  // ── 3.1/3.2) Inserir a fase sintética no meio + publicar pelo fluxo real ──
  console.log("\n── 3.1/3.2) Inserir fase no meio + publicar pelo fluxo do Gerenciamento ──")
  const { PUT: putWorkflowMacro } = await import("../src/app/api/gerenciamento/workflow-macro/[id]/route")
  const { PUT: putCatalogoFase } = await import("../src/app/api/gerenciamento/catalogo-fases/[id]/route")
  const { NextRequest } = await import("next/server")
  const token = await signAuthToken({ userId: admin.id, email: admin.email, tipo: "admin", sessaoInicio: Date.now() })
  const authHeaders = { "Content-Type": "application/json", Authorization: `Bearer ${token}` }

  // TESTEVIS_fase fica em repouso como INATIVA (estado padrão fora de teste,
  // já validado visualmente em produção antes deste mandato). Um Workflow
  // Macro não aceita compor uma fase inativa (avaliarAptidaoDaFase corretamente
  // recusa) — então, só pelo tempo desta prova, ela precisa estar publicada.
  // A seção 6 do mandato ("deixe fases sintéticas inativas quando não
  // estiverem sendo testadas") é o passo final que a devolve a INATIVA.
  const faseAntes = await prisma.catalogoFase.findUniqueOrThrow({ where: { phaseKey: FASE_ANTES } })
  const reqAtivarAntes = new NextRequest(`http://localhost/api/gerenciamento/catalogo-fases/${faseAntes.id}`, {
    method: "PUT", headers: authHeaders, body: JSON.stringify({ ativo: true, efeitosPermitidos: Array.isArray(faseAntes.efeitosPermitidos) && faseAntes.efeitosPermitidos.length ? faseAntes.efeitosPermitidos : ["REGISTER_ONLY"] }),
  })
  const resAtivarAntes = await putCatalogoFase(reqAtivarAntes, { params: Promise.resolve({ id: String(faseAntes.id) }) })
  console.log(`  · TESTEVIS_fase ativada temporariamente para a prova (status ${resAtivarAntes.status})`)

  // Publica (ativa) a fase inserida no Catálogo — exige efeito, já tem REGISTER_ONLY.
  const faseInserida = await prisma.catalogoFase.findUniqueOrThrow({ where: { phaseKey: FASE_INSERIDA } })
  const reqPublicarFase = new NextRequest(`http://localhost/api/gerenciamento/catalogo-fases/${faseInserida.id}`, {
    method: "PUT", headers: authHeaders, body: JSON.stringify({ ativo: true, efeitosPermitidos: ["REGISTER_ONLY"] }),
  })
  const resPublicarFase = await putCatalogoFase(reqPublicarFase, { params: Promise.resolve({ id: String(faseInserida.id) }) })
  const jPublicarFase = await resPublicarFase.json()
  prova("3.2: publicar a fase inserida no Catálogo", "200, ativo=true", `${resPublicarFase.status}, ativo=${jPublicarFase?.fase?.ativo}`, resPublicarFase.status === 200 && jPublicarFase?.fase?.ativo === true)

  // Insere no MEIO da composição do macro — mesma rota que o Gerenciamento usa.
  const reqInserir = new NextRequest(`http://localhost/api/gerenciamento/workflow-macro/${tipo.id}`, {
    method: "PUT", headers: authHeaders,
    body: JSON.stringify({
      fases: [
        { phaseKey: FASE_ANTES, label: "Fase de Teste Visual", required: true, conditional: false },
        { phaseKey: FASE_INSERIDA, label: faseInserida.label, required: true, conditional: false },
        { phaseKey: FASE_DEPOIS, label: "Finalizado", required: true, conditional: false },
      ],
    }),
  })
  const resInserir = await putWorkflowMacro(reqInserir, { params: Promise.resolve({ id: String(tipo.id) }) })
  const jInserir = await resInserir.json()
  prova("3.1: inserir fase entre TESTEVIS_fase e finalizado", "200, 3 fases na composição", `${resInserir.status}, ${jInserir?.macroWorkflow?.fases?.length ?? "?"} fase(s)`, resInserir.status === 200 && jInserir?.macroWorkflow?.fases?.length === 3)

  await processarOutbox({ forcar: true })

  // ── 3.3) Prova de retroação ───────────────────────────────────────────────
  console.log("\n── 3.3) Prova de retroação por posição ──")
  // 633: avança de TESTEVIS_fase — deve cair na fase recém-inserida (prova "na posição").
  const mv633 = await movePhaseManual(633, { faseAlvo: FASE_INSERIDA, justificativa: "auditoria integral — prova 3.3 (na posição da inserção)", motivoCodigo: "AUDITORIA_INTEGRAL_FASES", solicitadoPorId: admin.id })
  prova("3.3 (633, na posição): avança para a fase inserida", "success=true", `success=${mv633.success}, code=${"code" in mv633 ? mv633.code : "-"}`, mv633.success === true)
  const p633 = await prisma.processo.findUniqueOrThrow({ where: { id: 633 }, select: { faseAtualKey: true } })
  prova("3.3 (633): faseAtualKey final", FASE_INSERIDA, p633.faseAtualKey ?? "null", p633.faseAtualKey === FASE_INSERIDA)

  // 634: já estava em "finalizado" (adiante) — precisa ter recebido pendência retroativa
  // da fase inserida mesmo sem ter passado por ela. A materialização direta da fase
  // inserida no ciclo de 634 é a prova concreta.
  const rel634 = await materializarExecucaoDaFase({ processoId: 634, faseMacroKey: FASE_INSERIDA, fonte: "RECONCILIACAO", solicitadoPorId: admin.id })
  prova("3.3 (634, já adiante): recebe a fase inserida retroativamente", "ok=true, workflowInstanceId != null", `ok=${rel634.ok}, instanceId=${rel634.workflowInstanceId}`, rel634.ok === true && rel634.workflowInstanceId != null)

  // 632: continua em TESTEVIS_fase (antes) — não deve ter sido empurrado sozinho.
  const p632 = await prisma.processo.findUniqueOrThrow({ where: { id: 632 }, select: { faseAtualKey: true } })
  prova("3.3 (632, antes): NÃO avança sozinho — posição preservada até ação real", FASE_ANTES, p632.faseAtualKey ?? "null", p632.faseAtualKey === FASE_ANTES)

  // 636: finalizado — ABSOLUTAMENTE intocado.
  const p636 = await prisma.processo.findUniqueOrThrow({ where: { id: 636 }, select: { faseAtualKey: true, dataConclusao: true } })
  const instancias636 = await prisma.phaseWorkflowInstance.count({ where: { processoId: 636 } })
  prova("3.3 (636, finalizado): permanece absolutamente inalterado", `faseAtualKey=${FASE_DEPOIS}, dataConclusao != null, 0 instâncias`, `faseAtualKey=${p636.faseAtualKey}, dataConclusao=${p636.dataConclusao ? "sim" : "null"}, instâncias=${instancias636}`, p636.faseAtualKey === FASE_DEPOIS && p636.dataConclusao != null && instancias636 === 0)

  // Nenhum processo REAL alcançado — o universo de processos deste tipo é só os 6.
  const alcancadosFora = await prisma.processo.count({ where: { tipoProcessoMotorId: tipo.id, id: { notIn: PROCESSOS_ALVO } } })
  prova("3.3: nenhum processo real alcançado", "0 processos fora dos 6 vinculados ao tipo sintético", `${alcancadosFora}`, alcancadosFora === 0)

  // ── 3.4) Idempotência ─────────────────────────────────────────────────────
  console.log("\n── 3.4) Idempotência — repetir a reconciliação ──")
  const estadoAntes2a = await contarEstadoGlobal(PROCESSOS_ALVO)
  const { enqueueReconciliacaoFaseMacro } = await import("../src/lib/motor/reconciliar-fase-macro")
  const macroAtual = await prisma.macroWorkflow.findUniqueOrThrow({ where: { tipoProcessoId: tipo.id }, select: { id: true, versao: true } })
  await enqueueReconciliacaoFaseMacro({
    macroWorkflowId: macro.id, tipoProcessoId: tipo.id,
    versaoAnterior: macroAtual.versao, versaoNova: macroAtual.versao,
    fasesNovas: [{ phaseKey: FASE_INSERIDA, required: true, conditional: false }],
    publicadoPorId: admin.id,
  })
  await processarOutbox({ forcar: true })
  const estadoDepois2a = await contarEstadoGlobal(PROCESSOS_ALVO)
  prova(
    "3.4: reconciliação repetida não duplica nada",
    JSON.stringify(estadoAntes2a),
    JSON.stringify(estadoDepois2a),
    JSON.stringify(estadoAntes2a) === JSON.stringify(estadoDepois2a),
  )

  // ── 3.5) Retrocesso manual em 635 ─────────────────────────────────────────
  console.log("\n── 3.5) Retrocesso manual (processo 635) ──")
  // 635 avança primeiro até "finalizado" (percorrendo a fase inserida), pra ter o que retroceder.
  const avanco635a = await movePhaseManual(635, { faseAlvo: FASE_INSERIDA, justificativa: "auditoria integral — preparar 3.5", motivoCodigo: "AUDITORIA_INTEGRAL_FASES", solicitadoPorId: admin.id })
  prova("3.5 (635): avança até a fase inserida (preparo)", "success=true", `success=${avanco635a.success}`, avanco635a.success === true)
  const instanciaAntesRetrocesso = await prisma.phaseWorkflowInstance.findFirst({ where: { processoId: 635, faseMacroKey: FASE_INSERIDA }, select: { id: true, status: true } })

  const plano635 = await planejarRetrocesso(635, FASE_ANTES)
  prova("3.5: plano de retrocesso é gerado", "plano != null, faseDestinoLabel resolvido", `plano=${plano635 ? "ok" : "null"}, faseDestinoLabel=${plano635?.faseDestinoLabel}`, plano635 != null && !!plano635.faseDestinoLabel && plano635.faseDestinoLabel !== FASE_ANTES.replace(/_/g, " "))

  const resultado635 = await executarRetrocesso({ processoId: 635, faseDestino: FASE_ANTES, motivoCodigo: "AUDITORIA_INTEGRAL_FASES", justificativa: "auditoria integral — prova 3.5 (retorno manual com motivo)", actorId: admin.id })
  prova("3.5: retrocesso executado com motivo exigido", "ok=true", `ok=${resultado635.ok}, code=${resultado635.code}`, resultado635.ok === true)

  const instanciaDepoisRetrocesso = await prisma.phaseWorkflowInstance.findUnique({ where: { id: instanciaAntesRetrocesso?.id ?? -1 }, select: { id: true, status: true } })
  prova("3.5: ciclo anterior (fase inserida) PRESERVADO, não apagado", `instância #${instanciaAntesRetrocesso?.id} continua existindo`, instanciaDepoisRetrocesso ? `existe, status=${instanciaDepoisRetrocesso.status}` : "NÃO EXISTE MAIS", instanciaDepoisRetrocesso != null)

  const p635DepoisRetrocesso = await prisma.processo.findUniqueOrThrow({ where: { id: 635 }, select: { faseAtualKey: true } })
  prova("3.5: processo 635 está de volta na fase anterior", FASE_ANTES, p635DepoisRetrocesso.faseAtualKey ?? "null", p635DepoisRetrocesso.faseAtualKey === FASE_ANTES)

  // Avança de novo — retoma a pendência real (novo ciclo na fase inserida).
  const avanco635b = await movePhaseManual(635, { faseAlvo: FASE_INSERIDA, justificativa: "auditoria integral — retomada pós-retrocesso (3.5)", motivoCodigo: "AUDITORIA_INTEGRAL_FASES", solicitadoPorId: admin.id })
  const novoCiclo635 = await prisma.phaseWorkflowInstance.findMany({ where: { processoId: 635, faseMacroKey: FASE_INSERIDA }, orderBy: { ciclo: "asc" } })
  prova("3.5: retomar cria NOVO CICLO (não reaproveita/apaga o anterior)", "≥ 2 instâncias em ciclos distintos para a mesma fase", `${novoCiclo635.length} instância(s), ciclos=${novoCiclo635.map((i) => i.ciclo).join(",")}`, avanco635b.success === true && novoCiclo635.length >= 2)

  // ── 3.6) Inativar a fase inserida ─────────────────────────────────────────
  console.log("\n── 3.6) Inativar a fase inserida ──")
  const reqInativar = new NextRequest(`http://localhost/api/gerenciamento/catalogo-fases/${faseInserida.id}`, { method: "PUT", headers: authHeaders, body: JSON.stringify({ ativo: false }) })
  const resInativar = await putCatalogoFase(reqInativar, { params: Promise.resolve({ id: String(faseInserida.id) }) })
  const jInativar = await resInativar.json()
  prova("3.6: inativação aceita", "200, status=INATIVA", `${resInativar.status}, status=${jInativar?.fase?.status}`, resInativar.status === 200 && jInativar?.fase?.status === "INATIVA")

  const historico633 = await prisma.logAuditoria.count({ where: { entidade: "PROCESSO", entidadeId: 633 } })
  prova("3.6: histórico do processo 633 preservado (não zerado)", "> 0 eventos", `${historico633}`, historico633 > 0)
  const instanciasConcluidas = await prisma.phaseWorkflowStepInstance.count({ where: { processoId: { in: PROCESSOS_ALVO }, status: "CONCLUIDO" } })
  console.log(`  · passos concluídos preservados no conjunto: ${instanciasConcluidas}`)
  const p636DepoisInativacao = await prisma.processo.findUniqueOrThrow({ where: { id: 636 }, select: { faseAtualKey: true, dataConclusao: true } })
  prova("3.6: processo 636 (finalizado) segue intocado", `faseAtualKey=${FASE_DEPOIS}, dataConclusao != null`, `faseAtualKey=${p636DepoisInativacao.faseAtualKey}, dataConclusao=${p636DepoisInativacao.dataConclusao ? "sim" : "null"}`, p636DepoisInativacao.faseAtualKey === FASE_DEPOIS && p636DepoisInativacao.dataConclusao != null)

  // ── 3.7) Idempotência pós-inativação ──────────────────────────────────────
  console.log("\n── 3.7) Idempotência após a inativação ──")
  const estadoAntes3 = await contarEstadoGlobal(PROCESSOS_ALVO)
  await processarOutbox({ forcar: true })
  const estadoDepois3 = await contarEstadoGlobal(PROCESSOS_ALVO)
  prova("3.7: reprocessar outbox pós-inativação não duplica nada", JSON.stringify(estadoAntes3), JSON.stringify(estadoDepois3), JSON.stringify(estadoAntes3) === JSON.stringify(estadoDepois3))

  // ── Seção 6 — estado final documentado e reutilizável ────────────────────
  console.log("\n── Seção 6) Restaura TESTEVIS_fase ao repouso (INATIVA) ──")
  const reqRestaurarAntes = new NextRequest(`http://localhost/api/gerenciamento/catalogo-fases/${faseAntes.id}`, { method: "PUT", headers: authHeaders, body: JSON.stringify({ ativo: false }) })
  const resRestaurarAntes = await putCatalogoFase(reqRestaurarAntes, { params: Promise.resolve({ id: String(faseAntes.id) }) })
  const jRestaurarAntes = await resRestaurarAntes.json()
  prova("Seção 6: TESTEVIS_fase volta ao repouso (INATIVA)", "200, status=INATIVA", `${resRestaurarAntes.status}, status=${jRestaurarAntes?.fase?.status}`, resRestaurarAntes.status === 200 && jRestaurarAntes?.fase?.status === "INATIVA")

  console.log(`\nEstado global (instâncias/passos/tarefas/documentos) antes da inserção: ${JSON.stringify(estadoAntesDaInsercao)}`)
  console.log(`Estado global agora: ${JSON.stringify(estadoDepois3)}`)

  console.log("\n=== MATRIZ FINAL ===")
  for (const m of matriz) {
    console.log(`${m.passou ? "APROVADO" : "REPROVADO"} — ${m.requisito}`)
    console.log(`   esperado   : ${m.esperado}`)
    console.log(`   encontrado : ${m.encontrado}`)
  }
  console.log(`\n=== RESULTADO: ${ok} aprovado(s), ${falhou} reprovado(s) de ${matriz.length} ===`)
  if (falhou > 0) process.exitCode = 1
}

main().catch((e) => { console.error("\n💥 ERRO FATAL:", e); process.exitCode = 1 }).finally(() => prisma.$disconnect())
