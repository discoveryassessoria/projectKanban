// scripts/prova-reconciliacao-workflow-interno.ts
// PROVA PONTA A PONTA — reconciliação retroativa de Workflow Interno na fase
// atual (mandato "regra única de prazo" / "mudança precisa valer para
// processos em andamento", 23/09/2026). Cenário sintético, banco de teste.
//
// Publica uma versão nova (passo novo) de um Workflow Interno já em uso e
// verifica, com quatro processos em posições diferentes:
//   1) fase FUTURA (nunca materializou) — não toca nada agora; quando
//      materializar depois, usa a versão vigente.
//   2) fase ATUAL (materializada, em andamento) — aplica automaticamente: só
//      o passo novo nasce, o que já existia (status/dados/prazo) não muda.
//   3) fase JÁ ULTRAPASSADA — não é candidata, nada muda.
//   4) processo FINALIZADO — não é candidata, nada muda.
// E prova idempotência: reconciliar de novo não duplica nada.
import { exigirBancoDeTeste } from "./_banco-de-teste"
exigirBancoDeTeste("prova-reconciliacao-workflow-interno")

import { NextRequest } from "next/server"
import { prisma } from "../lib/prisma"
import { signAuthToken } from "../lib/auth-jwt"
import { criarProcessoV2 } from "../src/services/criar-processo"
import { materializarExecucaoDaFase } from "../src/services/materializar-fase"
import { processarOutbox, TIPOS_DRENADOS } from "../src/services/outbox-dispatcher"
import { reconciliarNovaVersaoNaInstanciaAtual } from "../src/services/phase-workflow"

const MARCA = "RECWFI"
const PAIS_KEY = `${MARCA.toLowerCase()}_pais`
const FASE_ALVO = "analise_documental" // PROCESSO-escopada, simples de medir (ver investigações anteriores desta sessão)
const FASE_DEPOIS = `${MARCA.toLowerCase()}_depois`

let passou = 0, falhou = 0
const ok = (nome: string, cond: boolean, extra = "") => {
  if (cond) { passou++; console.log(`  ✅ ${nome}${extra ? ` — ${extra}` : ""}`) }
  else { falhou++; console.log(`  ❌ ${nome}${extra ? ` — ${extra}` : ""}`) }
}

async function chamar(handler: any, method: string, path: string, token: string, body?: unknown, params?: Record<string, string>) {
  const init: any = { method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` } }
  if (body !== undefined) init.body = JSON.stringify(body)
  const req = new NextRequest(`http://localhost${path}`, init)
  return params ? handler(req, { params: Promise.resolve(params) }) : handler(req)
}

async function limpar() {
  const pais = await prisma.catalogoPais.findUnique({ where: { countryKey: PAIS_KEY } })
  if (pais) {
    const tipos = await prisma.tipoProcessoNacionalidade.findMany({ where: { paisId: pais.id }, select: { id: true } })
    const tipoIds = tipos.map((t) => t.id)
    const procs = await prisma.processo.findMany({ where: { tipoProcessoMotorId: { in: tipoIds } }, select: { id: true } })
    const procIds = procs.map((p) => p.id)
    await prisma.domainOutbox.deleteMany({ where: { aggregateType: "Processo", aggregateId: { in: procIds } } })
    await prisma.tarefa.deleteMany({ where: { processoId: { in: procIds } } })
    await prisma.phaseWorkflowStepInstance.deleteMany({ where: { processoId: { in: procIds } } })
    await prisma.phaseWorkflowInstance.deleteMany({ where: { processoId: { in: procIds } } })
    await prisma.processo.deleteMany({ where: { id: { in: procIds } } })
    const macros = await prisma.macroWorkflow.findMany({ where: { tipoProcessoId: { in: tipoIds } }, select: { id: true } })
    const wfs = await prisma.phaseInternalWorkflow.findMany({ where: { tipoProcessoId: { in: tipoIds } }, select: { id: true } })
    await prisma.phaseInternalWorkflowVersao.deleteMany({ where: { workflowId: { in: wfs.map((w) => w.id) } } })
    await prisma.phaseInternalWorkflow.deleteMany({ where: { id: { in: wfs.map((w) => w.id) } } })
    await prisma.faseMacro.deleteMany({ where: { macroWorkflowId: { in: macros.map((m) => m.id) } } })
    await prisma.macroWorkflowVersao.deleteMany({ where: { macroWorkflowId: { in: macros.map((m) => m.id) } } })
    await prisma.macroWorkflow.deleteMany({ where: { id: { in: macros.map((m) => m.id) } } })
    await prisma.tipoProcessoModalidadeHabilitada.deleteMany({ where: { tipoProcessoId: { in: tipoIds } } })
    await prisma.tipoProcessoNacionalidade.deleteMany({ where: { id: { in: tipoIds } } })
    await prisma.modalidadePais.deleteMany({ where: { paisId: pais.id } })
    await prisma.catalogoPais.delete({ where: { id: pais.id } }).catch(() => null)
  }
  await prisma.usuario.deleteMany({ where: { email: { endsWith: `@${MARCA.toLowerCase()}.test` } } })
}

async function main() {
  console.log(`\n=== PROVA — reconciliação de Workflow Interno na fase atual (${MARCA}) ===\n`)
  await limpar()
  await prisma.motorConfig.upsert({ where: { id: 1 }, update: { runtimeV2Habilitado: true }, create: { id: 1, runtimeV2Habilitado: true } })

  const admin = await prisma.usuario.create({ data: { nome: `Admin ${MARCA}`, email: `admin@${MARCA.toLowerCase()}.test`, senha: "x", tipo: "admin" } })
  const token = await signAuthToken({ userId: admin.id, email: admin.email, tipo: "admin", sessaoInicio: Date.now() })

  const { POST: postPaisesModalidades } = await import("../src/app/api/gerenciamento/paises/[countryKey]/modalidades/route")
  const { POST: postTipos } = await import("../src/app/api/gerenciamento/tipos-processo/route")
  const { POST: postWorkflowMacro } = await import("../src/app/api/gerenciamento/workflow-macro/route")
  const { POST: postWorkflows } = await import("../src/app/api/gerenciamento/workflows-fase/route")
  const { PUT: putWorkflow, POST: postPublicar } = await import("../src/app/api/gerenciamento/workflows-fase/[id]/route")

  // ---------- cadastro sintético ----------
  const pais = await prisma.catalogoPais.create({
    data: { countryKey: PAIS_KEY, countryLabel: `[${MARCA}] País`, nationalityKey: `${MARCA.toLowerCase()}_nac`, nationalityLabel: `[${MARCA}] Nacionalidade` },
  })
  await chamar(postPaisesModalidades, "POST", `/api/gerenciamento/paises/${PAIS_KEY}/modalidades`, token, { modalityKey: "judicial" }, { countryKey: PAIS_KEY })
  const modJud = await prisma.modalidadePais.findUniqueOrThrow({ where: { paisId_modalityKey: { paisId: pais.id, modalityKey: "judicial" } } })
  const rTipo = await chamar(postTipos, "POST", "/api/gerenciamento/tipos-processo", token, {
    code: `${MARCA}_TIPO`, name: `[${MARCA}] Nacionalidade de Teste`, countryKey: PAIS_KEY, modalityKeys: ["judicial"],
  })
  const tipoId = (await rTipo.json()).tipo.id as number

  await chamar(postWorkflowMacro, "POST", "/api/gerenciamento/workflow-macro", token, { tipoProcessoId: tipoId, modalidadeId: modJud.id, seedDefaults: true })
  const macro = await prisma.macroWorkflow.findFirstOrThrow({ where: { tipoProcessoId: tipoId } })
  await prisma.faseMacro.create({ data: { macroWorkflowId: macro.id, phaseKey: FASE_ALVO, label: "Análise Documental", ordem: 50, entryRule: "manual" } })
  await prisma.faseMacro.create({ data: { macroWorkflowId: macro.id, phaseKey: FASE_DEPOIS, label: "Depois (teste)", ordem: 60, entryRule: "manual" } })

  // Workflow Interno mínimo da fase inicial (genealogia) — só para satisfazer criarProcessoV2.
  const rWfGen = await chamar(postWorkflows, "POST", "/api/gerenciamento/workflows-fase", token, { criar: true, phaseKey: "genealogia", phaseLabel: "Genealogia", tipoProcessoId: tipoId })
  const wfGenId = (await rWfGen.json()).workflow.id as number
  await chamar(putWorkflow, "PUT", `/api/gerenciamento/workflows-fase/${wfGenId}`, token, {
    steps: [{ key: "passo_generico", label: "Passo genérico", ordem: 1, createsTask: true, required: true }],
  }, { id: String(wfGenId) })
  await chamar(postPublicar, "POST", `/api/gerenciamento/workflows-fase/${wfGenId}?acao=publicar`, token, {}, { id: String(wfGenId) })

  // Workflow Interno da fase ALVO — versão 1, um único passo (slaDays=7).
  const rWfAlvo = await chamar(postWorkflows, "POST", "/api/gerenciamento/workflows-fase", token, { criar: true, phaseKey: FASE_ALVO, phaseLabel: "Análise Documental", tipoProcessoId: tipoId })
  const wfAlvoId = (await rWfAlvo.json()).workflow.id as number
  await chamar(putWorkflow, "PUT", `/api/gerenciamento/workflows-fase/${wfAlvoId}`, token, {
    steps: [{ key: "passo_original", label: "Passo original", ordem: 1, createsTask: true, required: true, slaDays: 7, regraDeConclusao: "ACAO_DO_PASSO" }],
  }, { id: String(wfAlvoId) })
  const rPub1 = await chamar(postPublicar, "POST", `/api/gerenciamento/workflows-fase/${wfAlvoId}?acao=publicar`, token, {}, { id: String(wfAlvoId) })
  const pub1 = await rPub1.json()
  console.log("v1 publicada:", pub1.versaoNova ?? pub1)

  // ---------- quatro processos, quatro posições ----------
  async function criarProcesso(sufixo: string) {
    const r = (await criarProcessoV2({ nome: `${MARCA} ${sufixo}`, pais: PAIS_KEY, tipoProcessoMotorId: tipoId, modalidadeId: modJud.id })) as any
    if (!r.success) throw new Error(`processo ${sufixo} não criado: ${JSON.stringify(r)}`)
    return r.processId as number
  }

  const procFuturo = await criarProcesso("futuro") // fica em "genealogia" — nunca chega na FASE_ALVO
  const procAtual = await criarProcesso("atual")
  const procPassado = await criarProcesso("passado")
  const procFinalizado = await criarProcesso("finalizado")

  // proc ATUAL: materializa a fase alvo agora, sob a v1.
  await prisma.processo.update({ where: { id: procAtual }, data: { faseAtualKey: FASE_ALVO } })
  await materializarExecucaoDaFase({ processoId: procAtual, faseMacroKey: FASE_ALVO, fonte: "RECONCILIACAO" })
  const tarefaAntesId = (await prisma.tarefa.findFirst({ where: { processoId: procAtual }, orderBy: { id: "asc" } }))!.id
  // Simula trabalho real já feito: atribui responsável, preenche observação.
  await prisma.tarefa.update({ where: { id: tarefaAntesId }, data: { responsavelId: admin.id, observacoes: "dado preenchido antes da reconciliação — não pode sumir nem mudar" } })
  const tarefaAntes = await prisma.tarefa.findUniqueOrThrow({ where: { id: tarefaAntesId } })

  // proc PASSADO: materializa a fase alvo, conclui a instância, avança "manualmente" para depois.
  await prisma.processo.update({ where: { id: procPassado }, data: { faseAtualKey: FASE_ALVO } })
  await materializarExecucaoDaFase({ processoId: procPassado, faseMacroKey: FASE_ALVO, fonte: "RECONCILIACAO" })
  const instPassada = await prisma.phaseWorkflowInstance.findFirstOrThrow({ where: { processoId: procPassado, faseMacroKey: FASE_ALVO } })
  await prisma.phaseWorkflowInstance.update({ where: { id: instPassada.id }, data: { status: "CONCLUIDO" } })
  await prisma.processo.update({ where: { id: procPassado }, data: { faseAtualKey: FASE_DEPOIS } })

  // proc FINALIZADO: materializa, conclui, e finaliza o processo.
  await prisma.processo.update({ where: { id: procFinalizado }, data: { faseAtualKey: FASE_ALVO } })
  await materializarExecucaoDaFase({ processoId: procFinalizado, faseMacroKey: FASE_ALVO, fonte: "RECONCILIACAO" })
  const instFinalizado = await prisma.phaseWorkflowInstance.findFirstOrThrow({ where: { processoId: procFinalizado, faseMacroKey: FASE_ALVO } })
  await prisma.phaseWorkflowInstance.update({ where: { id: instFinalizado.id }, data: { status: "CONCLUIDO" } })
  await prisma.processo.update({ where: { id: procFinalizado }, data: { faseAtualKey: "finalizado", dataConclusao: new Date() } })

  console.log("\n── cenário pronto ──")
  console.log({ procFuturo, procAtual, procPassado, procFinalizado })

  // ---------- publica v2 (passo novo) ----------
  await chamar(putWorkflow, "PUT", `/api/gerenciamento/workflows-fase/${wfAlvoId}`, token, {
    steps: [
      { key: "passo_original", label: "Passo original", ordem: 1, createsTask: true, required: true, slaDays: 7, regraDeConclusao: "ACAO_DO_PASSO" },
      { key: "passo_novo", label: "Passo novo", ordem: 2, createsTask: true, required: true, slaDays: 3, regraDeConclusao: "ACAO_DO_PASSO" },
    ],
  }, { id: String(wfAlvoId) })
  const rPub2 = await chamar(postPublicar, "POST", `/api/gerenciamento/workflows-fase/${wfAlvoId}?acao=publicar`, token, {}, { id: String(wfAlvoId) })
  const pub2 = await rPub2.json()
  console.log("v2 publicada:", pub2.versaoNova ?? pub2)

  const outboxAntes = await prisma.domainOutbox.count({ where: { tipo: "workflow-interno.fase-atual.reconciliar" } })
  ok("publicar v2 enfileirou reconciliação (outbox registrado)", outboxAntes > 0, `${outboxAntes} linha(s)`)

  // ---------- drena a outbox real (o mesmo dispatcher de produção) ----------
  const resumo1 = await processarOutbox({ tipos: [...TIPOS_DRENADOS] })
  console.log("1ª drenagem:", JSON.stringify({ processados: resumo1.processados, falhos: resumo1.falhos }, null, 2))

  // ═══ 1) FUTURA — não toca nada agora ═══
  console.log("\n1) fase FUTURA (nunca materializou)")
  const instFuturo = await prisma.phaseWorkflowInstance.findFirst({ where: { processoId: procFuturo, faseMacroKey: FASE_ALVO } })
  ok("nenhuma instância foi criada para quem ainda não chegou na fase", instFuturo == null)
  // Quando chegar, materializa sob a versão VIGENTE (v2, 2 passos) — não a v1.
  await prisma.processo.update({ where: { id: procFuturo }, data: { faseAtualKey: FASE_ALVO } })
  const relFuturo = await materializarExecucaoDaFase({ processoId: procFuturo, faseMacroKey: FASE_ALVO, fonte: "AVANCO_AUTOMATICO" })
  ok("ao materializar depois, usa a configuração vigente (2 passos, v2)", relFuturo.passosTotais === 2, `${relFuturo.passosTotais} passo(s)`)

  // ═══ 2) ATUAL — aplica automaticamente, preserva o que já existia ═══
  console.log("\n2) fase ATUAL (materializada, em andamento)")
  const stepsAtual = await prisma.phaseWorkflowStepInstance.findMany({ where: { processoId: procAtual, faseMacroKey: FASE_ALVO }, orderBy: { ordem: "asc" } })
  ok("o passo novo foi criado na MESMA instância (sem duplicar)", stepsAtual.length === 2, `${stepsAtual.length} passo(s)`)
  const instanciasAtual = await prisma.phaseWorkflowInstance.count({ where: { processoId: procAtual, faseMacroKey: FASE_ALVO } })
  ok("continua existindo UMA ÚNICA instância da fase (não duplicou)", instanciasAtual === 1, `${instanciasAtual} instância(s)`)
  const tarefaDepois = await prisma.tarefa.findUniqueOrThrow({ where: { id: tarefaAntesId } })
  ok("a Tarefa original é A MESMA (mesmo id)", tarefaDepois.id === tarefaAntes.id)
  ok("o responsável atribuído antes NÃO foi apagado", tarefaDepois.responsavelId === admin.id)
  ok("a observação preenchida antes NÃO foi apagada", tarefaDepois.observacoes === tarefaAntes.observacoes)
  ok("o prazo da tarefa original é EXATAMENTE o mesmo (não reiniciou a contagem)", tarefaDepois.dataPrazo?.getTime() === tarefaAntes.dataPrazo?.getTime())
  // O passo novo (ordem 2) nasce PENDENTE — bloqueado pelo passo original
  // (ordem 1) ainda não concluído, execução sequencial. Ainda não é "trabalho
  // necessário agora": correto NÃO gerar Tarefa dele ainda (mesma regra que
  // vale para qualquer workflow novo). A Tarefa antiga continua sendo a ÚNICA.
  const passoNovoInst = await prisma.phaseWorkflowStepInstance.findFirstOrThrow({ where: { processoId: procAtual, stepKey: "passo_novo" } })
  ok("o passo novo nasce PENDENTE (bloqueado pela dependência sequencial, não pulou a fila)", passoNovoInst.status === "PENDENTE", passoNovoInst.status)
  // Escopo por tarefa OPERACIONAL (ligada a um passo) — exclui a tarefa
  // administrativa "Atribuir tarefas" (bookkeeping não relacionado, sem
  // workflowStepInstanceId, já observada nesta sessão em cenários sintéticos
  // sem responsável de equipe cadastrado).
  const tarefasOperacionais = () => prisma.tarefa.count({ where: { processoId: procAtual, workflowStepInstanceId: { not: null } } })
  ok("nenhuma tarefa operacional prematura foi criada para o passo ainda bloqueado — continua só a original", (await tarefasOperacionais()) === 1, `${await tarefasOperacionais()} tarefa(s)`)

  // Concluir o passo original libera o passo novo. Como os dois pertencem à
  // MESMA unidade de trabalho (fase PROCESSO-escopada — "Uma obrigação, uma
  // tarefa", CLAUDE.md §1), a MESMA Tarefa avança para o passo novo — não
  // nasce uma segunda. É exatamente a prova que a regra pede: um único
  // prazo final por tarefa, sem reiniciar a contagem silenciosamente.
  const { concluirPasso } = await import("../src/services/task-step-sync")
  await concluirPasso(tarefaAntes.workflowStepInstanceId!, { origem: "USER", usuarioId: admin.id, correlationId: "teste-reconciliacao" })
  const passoNovoDepois = await prisma.phaseWorkflowStepInstance.findUniqueOrThrow({ where: { id: passoNovoInst.id } })
  ok("ao concluir o passo original, o passo novo fica DISPONÍVEL", passoNovoDepois.status === "DISPONIVEL", passoNovoDepois.status)
  ok("continua havendo UMA SÓ tarefa operacional (a mesma avançou de etapa, não nasceu outra)", (await tarefasOperacionais()) === 1, `${await tarefasOperacionais()} tarefa(s)`)
  const tarefaAntigaFinal = await prisma.tarefa.findUniqueOrThrow({ where: { id: tarefaAntesId } })
  ok("a MESMA tarefa agora aponta para o passo novo (etapa corrente avançou)", tarefaAntigaFinal.workflowStepInstanceId === passoNovoInst.id)
  ok("o prazo continua o ORIGINAL (7 dias) — não foi reiniciado nem sobrescrito pelo prazo do passo novo (3 dias)",
    tarefaAntigaFinal.dataPrazo?.getTime() === tarefaAntes.dataPrazo!.getTime())
  ok("o responsável atribuído manualmente antes da reconciliação sobreviveu ao avanço de etapa",
    tarefaAntigaFinal.responsavelId === admin.id)

  // ═══ 3) JÁ ULTRAPASSADA — não é candidata, nada muda ═══
  console.log("\n3) fase JÁ ULTRAPASSADA")
  const stepsPassado = await prisma.phaseWorkflowStepInstance.count({ where: { processoId: procPassado, faseMacroKey: FASE_ALVO } })
  ok("continua com só o passo original — nada foi acrescentado numa fase já concluída", stepsPassado === 1, `${stepsPassado} passo(s)`)
  const instPassadaDepois = await prisma.phaseWorkflowInstance.findUniqueOrThrow({ where: { id: instPassada.id } })
  ok("a instância continua CONCLUIDO — reconciliação não reabriu nem retrocedeu", instPassadaDepois.status === "CONCLUIDO")

  // ═══ 4) FINALIZADO — não é candidata, nada muda ═══
  console.log("\n4) processo FINALIZADO")
  const stepsFinalizado = await prisma.phaseWorkflowStepInstance.count({ where: { processoId: procFinalizado, faseMacroKey: FASE_ALVO } })
  ok("continua com só o passo original — processo finalizado nunca é alterado", stepsFinalizado === 1, `${stepsFinalizado} passo(s)`)

  // ═══ idempotência — reconciliar de novo não duplica nada ═══
  console.log("\n5) idempotência — reconciliar de novo")
  const direto1 = await reconciliarNovaVersaoNaInstanciaAtual({ processoId: procAtual, faseMacroKey: FASE_ALVO })
  ok("chamar a reconciliação direto de novo não aplica nada (SEM_TRABALHO_NOVO)", direto1.success && !direto1.aplicado && direto1.motivo === "SEM_TRABALHO_NOVO", JSON.stringify(direto1))
  const resumo2 = await processarOutbox({ tipos: [...TIPOS_DRENADOS] })
  const stepsAtual2 = await prisma.phaseWorkflowStepInstance.count({ where: { processoId: procAtual, faseMacroKey: FASE_ALVO } })
  const tarefasAtual2 = await tarefasOperacionais()
  const instanciasAtual2 = await prisma.phaseWorkflowInstance.count({ where: { processoId: procAtual, faseMacroKey: FASE_ALVO } })
  ok("depois de reconciliar de novo, continua 2 passos (não duplicou)", stepsAtual2 === 2, `${stepsAtual2}`)
  ok("depois de reconciliar de novo, continua 1 tarefa operacional (não duplicou)", tarefasAtual2 === 1, `${tarefasAtual2}`)
  ok("depois de reconciliar de novo, continua 1 instância (não duplicou)", instanciasAtual2 === 1, `${instanciasAtual2}`)

  // ═══ histórico de versões preservado ═══
  console.log("\n6) histórico de versões")
  const versoes = await prisma.phaseInternalWorkflowVersao.findMany({ where: { workflowId: wfAlvoId }, orderBy: { versao: "asc" } })
  const v1 = versoes.find((v) => v.versao === pub1.versaoNova)
  const v2 = versoes.find((v) => v.versao === pub2.versaoNova)
  ok("a versão publicada ANTES da reconciliação continua congelada e intacta (1 passo)",
    Array.isArray((v1?.passos as unknown[] | undefined)) && (v1!.passos as unknown[]).length === 1, `versão ${pub1.versaoNova}`)
  ok("a versão publicada NA reconciliação continua congelada e intacta (2 passos)",
    Array.isArray((v2?.passos as unknown[] | undefined)) && (v2!.passos as unknown[]).length === 2, `versão ${pub2.versaoNova}`)

  console.log(`\n══════════════════════════════════════\nTotal: ${passou + falhou} | ✅ ${passou} | ❌ ${falhou}`)
  await limpar()
  await prisma.$disconnect()
  if (falhou > 0) process.exit(1)
}

main().catch(async (e) => {
  console.error(e)
  try { await limpar() } catch { /* melhor esforço */ }
  await prisma.$disconnect()
  process.exit(1)
})
