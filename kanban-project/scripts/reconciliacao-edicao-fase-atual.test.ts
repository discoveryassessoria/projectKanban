// scripts/reconciliacao-edicao-fase-atual.test.ts
// PROVA PONTA A PONTA — atualização automática (edição/inclusão/remoção) de
// tarefas existentes na fase atual (mandato "complete a atualização
// automática de tarefas existentes na fase atual", 23/09/2026).
//
// Complementa scripts/reconciliacao-workflow-interno-fase-atual.test.ts (que
// prova a parte ADITIVA: passo novo, isolamento por tipo, fases
// ultrapassada/finalizada, idempotência, histórico de versões). Aqui: edição
// de conteúdo de passo já materializado, inclusão/remoção de subtarefa,
// recálculo de prazo pela origem original, conflito nomeado quando o dado já
// existente torna a mudança insegura, publicação com edição+inclusão juntas,
// preservação de concluídas.
import { exigirBancoDeTeste } from "./_banco-de-teste"
exigirBancoDeTeste("reconciliacao-edicao-fase-atual")

import { NextRequest } from "next/server"
import { prisma } from "../lib/prisma"
import { signAuthToken } from "../lib/auth-jwt"
import { criarProcessoV2 } from "../src/services/criar-processo"
import { materializarExecucaoDaFase } from "../src/services/materializar-fase"
import { processarOutbox, TIPOS_DRENADOS } from "../src/services/outbox-dispatcher"
import { reconciliarNovaVersaoNaInstanciaAtual } from "../src/services/phase-workflow"
import { prazoOperacional } from "../lib/operacional/tempo-operacional"

const MARCA = "RECEDIT"
const PAIS_KEY = `${MARCA.toLowerCase()}_pais`
const FASE_ALVO = "analise_documental"

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
  // CatalogoFase de "analise_documental" não existia no banco de teste antes
  // deste script (confirmado antes de criar) — remove para não deixar
  // competência de fase cadastrada como efeito colateral do teste.
  if (!CATALOGO_FASE_JA_EXISTIA) {
    await prisma.catalogoFase.deleteMany({ where: { phaseKey: FASE_ALVO } })
  }
}

let CATALOGO_FASE_JA_EXISTIA = false

async function main() {
  console.log(`\n=== PROVA — atualização automática (edição/inclusão/remoção) na fase atual (${MARCA}) ===\n`)
  await limpar()
  await prisma.motorConfig.upsert({ where: { id: 1 }, update: { runtimeV2Habilitado: true }, create: { id: 1, runtimeV2Habilitado: true } })

  const admin = await prisma.usuario.create({ data: { nome: `Admin ${MARCA}`, email: `admin@${MARCA.toLowerCase()}.test`, senha: "x", tipo: "admin" } })
  const token = await signAuthToken({ userId: admin.id, email: admin.email, tipo: "admin", sessaoInicio: Date.now() })

  const { POST: postPaisesModalidades } = await import("../src/app/api/gerenciamento/paises/[countryKey]/modalidades/route")
  const { POST: postTipos } = await import("../src/app/api/gerenciamento/tipos-processo/route")
  const { POST: postWorkflowMacro } = await import("../src/app/api/gerenciamento/workflow-macro/route")
  const { POST: postWorkflows } = await import("../src/app/api/gerenciamento/workflows-fase/route")
  const { PUT: putWorkflow, POST: postPublicar } = await import("../src/app/api/gerenciamento/workflows-fase/[id]/route")

  // ---------- cadastro sintético: DOIS tipos, para provar isolamento ----------
  const pais = await prisma.catalogoPais.create({
    data: { countryKey: PAIS_KEY, countryLabel: `[${MARCA}] País`, nationalityKey: `${MARCA.toLowerCase()}_nac`, nationalityLabel: `[${MARCA}] Nacionalidade` },
  })
  await chamar(postPaisesModalidades, "POST", `/api/gerenciamento/paises/${PAIS_KEY}/modalidades`, token, { modalityKey: "judicial" }, { countryKey: PAIS_KEY })
  const modJud = await prisma.modalidadePais.findUniqueOrThrow({ where: { paisId_modalityKey: { paisId: pais.id, modalityKey: "judicial" } } })

  const rTipoA = await chamar(postTipos, "POST", "/api/gerenciamento/tipos-processo", token, {
    code: `${MARCA}_TIPO_A`, name: `[${MARCA}] Nacionalidade A`, countryKey: PAIS_KEY, modalityKeys: ["judicial"],
  })
  const tipoAId = (await rTipoA.json()).tipo.id as number
  const rTipoB = await chamar(postTipos, "POST", "/api/gerenciamento/tipos-processo", token, {
    code: `${MARCA}_TIPO_B`, name: `[${MARCA}] Nacionalidade B (isolamento)`, countryKey: PAIS_KEY, modalityKeys: ["judicial"],
  })
  const tipoBId = (await rTipoB.json()).tipo.id as number

  // Competência de fase — sem isto, nenhum effectKey é permitido em
  // "analise_documental" (ausência não autoriza, ver catalogo-de-efeitos.ts).
  // Usa exatamente os efeitos da competência padrão da fase (ANALISE+GERAL).
  // `ativo: false` de propósito: `seedDefaults` (abaixo) varre `CatalogoFase`
  // com `ativo:true` para semear fases padrão do macro — este registro é só
  // para liberar a competência de efeito, não para entrar no seed.
  CATALOGO_FASE_JA_EXISTIA = (await prisma.catalogoFase.findUnique({ where: { phaseKey: FASE_ALVO } })) != null
  const { efeitosPorCompetenciaPadrao } = await import("../src/lib/motor/catalogo-de-efeitos")
  await prisma.catalogoFase.upsert({
    where: { phaseKey: FASE_ALVO },
    update: { efeitosPermitidos: efeitosPorCompetenciaPadrao(FASE_ALVO) },
    create: { phaseKey: FASE_ALVO, label: "Análise Documental", ativo: false, efeitosPermitidos: efeitosPorCompetenciaPadrao(FASE_ALVO) },
  })

  for (const tipoId of [tipoAId, tipoBId]) {
    await chamar(postWorkflowMacro, "POST", "/api/gerenciamento/workflow-macro", token, { tipoProcessoId: tipoId, modalidadeId: modJud.id, seedDefaults: true })
    const macro = await prisma.macroWorkflow.findFirstOrThrow({ where: { tipoProcessoId: tipoId } })
    await prisma.faseMacro.create({ data: { macroWorkflowId: macro.id, phaseKey: FASE_ALVO, label: "Análise Documental", ordem: 50, entryRule: "manual" } })

    const rWfGen = await chamar(postWorkflows, "POST", "/api/gerenciamento/workflows-fase", token, { criar: true, phaseKey: "genealogia", phaseLabel: "Genealogia", tipoProcessoId: tipoId })
    const wfGenId = (await rWfGen.json()).workflow.id as number
    await chamar(putWorkflow, "PUT", `/api/gerenciamento/workflows-fase/${wfGenId}`, token, {
      steps: [{ key: "passo_generico", label: "Passo genérico", ordem: 1, createsTask: true, required: true }],
    }, { id: String(wfGenId) })
    await chamar(postPublicar, "POST", `/api/gerenciamento/workflows-fase/${wfGenId}?acao=publicar`, token, {}, { id: String(wfGenId) })
  }

  // Workflow Interno da fase ALVO, específico do TIPO A — v1: um passo, com
  // uma subtarefa que ficará intocada (prova de remoção segura) e outra que
  // será tocada (prova de conflito na remoção).
  const rWfA = await chamar(postWorkflows, "POST", "/api/gerenciamento/workflows-fase", token, { criar: true, phaseKey: FASE_ALVO, phaseLabel: "Análise Documental", tipoProcessoId: tipoAId })
  const wfAId = (await rWfA.json()).workflow.id as number
  const passoV1 = {
    key: "passo_a", label: "Rótulo original", description: "Descrição original", ordem: 1,
    createsTask: true, required: true, slaDays: 7, regraDeConclusao: "ACAO_DO_PASSO",
    subtarefas: [
      { key: "sub_intocada", label: "Subtarefa intocada", ordem: 1, obrigatoria: false, acoes: [{ key: "concluir", label: "Concluir", effectKey: "REGISTER_ONLY" }] },
      { key: "sub_tocada", label: "Subtarefa tocada", ordem: 2, obrigatoria: false, acoes: [{ key: "concluir", label: "Concluir", effectKey: "REGISTER_ONLY" }] },
    ],
  }
  await chamar(putWorkflow, "PUT", `/api/gerenciamento/workflows-fase/${wfAId}`, token, { steps: [passoV1] }, { id: String(wfAId) })
  const rPub1 = await chamar(postPublicar, "POST", `/api/gerenciamento/workflows-fase/${wfAId}?acao=publicar`, token, {}, { id: String(wfAId) })
  const pub1 = await rPub1.json()
  console.log("v1 (tipo A) publicada:", pub1.versaoNova ?? pub1)

  // Workflow do TIPO B — mesmo phaseKey, workflow INDEPENDENTE (prova de
  // isolamento: publicar em A nunca alcança B).
  const rWfB = await chamar(postWorkflows, "POST", "/api/gerenciamento/workflows-fase", token, { criar: true, phaseKey: FASE_ALVO, phaseLabel: "Análise Documental", tipoProcessoId: tipoBId })
  const wfBId = (await rWfB.json()).workflow.id as number
  await chamar(putWorkflow, "PUT", `/api/gerenciamento/workflows-fase/${wfBId}`, token, {
    steps: [{ key: "passo_a", label: "Rótulo original (tipo B)", ordem: 1, createsTask: true, required: true, slaDays: 7, regraDeConclusao: "ACAO_DO_PASSO" }],
  }, { id: String(wfBId) })
  await chamar(postPublicar, "POST", `/api/gerenciamento/workflows-fase/${wfBId}?acao=publicar`, token, {}, { id: String(wfBId) })

  // ---------- processos: um por cenário ----------
  async function criarProcesso(tipoId: number, sufixo: string) {
    const r = (await criarProcessoV2({ nome: `${MARCA} ${sufixo}`, pais: PAIS_KEY, tipoProcessoMotorId: tipoId, modalidadeId: modJud.id })) as any
    if (!r.success) throw new Error(`processo ${sufixo} não criado: ${JSON.stringify(r)}`)
    return r.processId as number
  }
  async function materializarNaFaseAlvo(processoId: number) {
    await prisma.processo.update({ where: { id: processoId }, data: { faseAtualKey: FASE_ALVO } })
    await materializarExecucaoDaFase({ processoId, faseMacroKey: FASE_ALVO, fonte: "RECONCILIACAO" })
  }
  const passoDe = (processoId: number) => prisma.phaseWorkflowStepInstance.findFirstOrThrow({ where: { processoId, faseMacroKey: FASE_ALVO, stepKey: "passo_a" } })
  const tarefaDe = (processoId: number) => prisma.tarefa.findFirstOrThrow({ where: { processoId, workflowStepInstanceId: { not: null } } })

  // A) edição segura (passo intocado)
  const procEdicao = await criarProcesso(tipoAId, "edicao")
  await materializarNaFaseAlvo(procEdicao)
  const tarefaEdicaoAntes = await tarefaDe(procEdicao)
  await prisma.tarefa.update({ where: { id: tarefaEdicaoAntes.id }, data: { responsavelId: admin.id, observacoes: "não pode sumir" } })

  // B) prazo (passo intocado, sla muda 7→10)
  const procPrazo = await criarProcesso(tipoAId, "prazo")
  await materializarNaFaseAlvo(procPrazo)
  const tarefaPrazoAntes = await tarefaDe(procPrazo)

  // C) remoção segura (subtarefa nunca tocada)
  const procRemocaoSegura = await criarProcesso(tipoAId, "remocao-segura")
  await materializarNaFaseAlvo(procRemocaoSegura)

  // D) remoção com conflito (subtarefa tocada)
  const procRemocaoConflito = await criarProcesso(tipoAId, "remocao-conflito")
  await materializarNaFaseAlvo(procRemocaoConflito)
  const passoConflito = await passoDe(procRemocaoConflito)
  await prisma.subtaskExecution.create({
    data: {
      stepInstanceId: passoConflito.id, subtaskKey: "sub_tocada", subtaskDefinitionId: null, sequencia: 1,
      status: "EM_ANDAMENTO", motivo: "ABERTURA", startedAt: new Date(),
      chaveIdempotencia: `${MARCA}-subexec-${passoConflito.id}-sub_tocada`,
    },
  })

  // E) passo já em execução (edição de conteúdo deve virar conflito)
  const procPassoTocado = await criarProcesso(tipoAId, "passo-tocado")
  await materializarNaFaseAlvo(procPassoTocado)
  const passoTocadoInst = await passoDe(procPassoTocado)
  await prisma.phaseWorkflowStepInstance.update({ where: { id: passoTocadoInst.id }, data: { startedAt: new Date() } })

  // F) concluída — nunca deve ser reavaliada, mesmo com mudança de conteúdo
  const procConcluido = await criarProcesso(tipoAId, "concluido")
  await materializarNaFaseAlvo(procConcluido)
  const passoConcluidoInst = await passoDe(procConcluido)
  await prisma.phaseWorkflowStepInstance.update({ where: { id: passoConcluidoInst.id }, data: { status: "CONCLUIDO", startedAt: new Date(), completedAt: new Date() } })
  await prisma.tarefa.updateMany({ where: { workflowStepInstanceId: passoConcluidoInst.id }, data: { concluida: true, statusTarefa: "CONCLUIDO_RECEBIDO", dataConclusao: new Date() } })

  // G) isolamento — mesmo phaseKey, TIPO B, workflow independente
  const procIsolamento = await criarProcesso(tipoBId, "isolamento")
  await materializarNaFaseAlvo(procIsolamento)

  console.log("\n── cenário pronto ──")

  // ---------- publica v2 do TIPO A: edição + inclusão + remoção juntas ----------
  const passoV2 = {
    key: "passo_a", label: "Rótulo EDITADO", description: "Descrição editada", ordem: 1,
    createsTask: true, required: true, slaDays: 10, regraDeConclusao: "ACAO_DO_PASSO",
    subtarefas: [
      { key: "sub_nova", label: "Subtarefa NOVA", ordem: 1, obrigatoria: false, acompanhamentoAtivo: true, acompanhamentoPrimeiroDias: 3, acoes: [{ key: "concluir", label: "Concluir", effectKey: "REGISTER_ONLY" }] },
      // "sub_intocada" e "sub_tocada" REMOVIDAS na v2.
    ],
  }
  await chamar(putWorkflow, "PUT", `/api/gerenciamento/workflows-fase/${wfAId}`, token, { steps: [passoV2] }, { id: String(wfAId) })
  const rPub2 = await chamar(postPublicar, "POST", `/api/gerenciamento/workflows-fase/${wfAId}?acao=publicar`, token, {}, { id: String(wfAId) })
  const pub2 = await rPub2.json()
  console.log("v2 (tipo A) publicada:", pub2.versaoNova ?? pub2)

  const resumo1 = await processarOutbox({ tipos: [...TIPOS_DRENADOS] })
  console.log("1ª drenagem:", JSON.stringify({ processados: resumo1.processados, falhos: resumo1.falhos }, null, 2))

  // ═══ A/G) edição segura + inclusão de subtarefa (mesmo passo, processo sem conflito) ═══
  console.log("\nA) edição de tarefa existente + inclusão de subtarefa (publicação combinada)")
  const passoEdicaoDepois = await passoDe(procEdicao)
  const snapEdicao = passoEdicaoDepois.snapshot as any
  ok("o rótulo foi atualizado (config aplicada)", snapEdicao?.titulo === "Rótulo EDITADO", snapEdicao?.titulo)
  ok("a descrição foi atualizada", snapEdicao?.descricao === "Descrição editada")
  const tarefaEdicaoDepois = await prisma.tarefa.findUniqueOrThrow({ where: { id: tarefaEdicaoAntes.id } })
  ok("a Tarefa continua sendo A MESMA (mesmo id)", tarefaEdicaoDepois.id === tarefaEdicaoAntes.id)
  ok("o responsável atribuído antes NÃO foi apagado", tarefaEdicaoDepois.responsavelId === admin.id)
  ok("a observação preenchida antes NÃO foi apagada", tarefaEdicaoDepois.observacoes === "não pode sumir")

  console.log("\nB) inclusão de subtarefa + acompanhamento separado do prazo único")
  const { subtarefasDaEtapa } = await import("../src/services/subtarefas-da-etapa")
  const subsEdicao = await subtarefasDaEtapa({ stepInstanceId: passoEdicaoDepois.id })
  const subNova = subsEdicao.find((s) => s.key === "sub_nova")
  ok("a subtarefa nova aparece na lista do passo já materializado", subNova != null)
  // O prazo da tarefa MUDOU nesta publicação (o SLA do passo também foi
  // editado, de 7 para 10 — cenário C prova esse recálculo em detalhe). O
  // que esta asserção prova é outra coisa: o valor bate EXATAMENTE com o
  // que só o SLA novo explicaria — o acompanhamento da subtarefa nova
  // (acompanhamentoPrimeiroDias=3) não vazou nem um dia para dentro dele.
  const esperadoSoComSla = prazoOperacional(10, tarefaEdicaoAntes.createdAt)
  ok("o prazo reflete SÓ o SLA novo do passo — o acompanhamento da subtarefa nova não vaza para o vencimento único da tarefa",
    tarefaEdicaoDepois.dataPrazo != null && esperadoSoComSla != null && Math.abs(tarefaEdicaoDepois.dataPrazo.getTime() - esperadoSoComSla.getTime()) < 1000,
    `${tarefaEdicaoDepois.dataPrazo?.toISOString()} vs ${esperadoSoComSla?.toISOString()}`)

  // ═══ C) prazo recalculado pela origem original ═══
  console.log("\nC) alteração de prazo — recálculo pela origem original (não 'agora')")
  const tarefaPrazoDepois = await prisma.tarefa.findUniqueOrThrow({ where: { id: tarefaPrazoAntes.id } })
  const esperado = prazoOperacional(10, tarefaPrazoAntes.createdAt)
  ok("o prazo foi recalculado com o SLA novo (10d) a partir da MESMA origem (Tarefa.createdAt)",
    tarefaPrazoDepois.dataPrazo != null && esperado != null && Math.abs(tarefaPrazoDepois.dataPrazo.getTime() - esperado.getTime()) < 1000,
    `${tarefaPrazoDepois.dataPrazo?.toISOString()} vs esperado ${esperado?.toISOString()}`)
  ok("o prazo NÃO foi recalculado a partir de 'agora' (origem preservada)",
    Math.abs(tarefaPrazoDepois.dataPrazo!.getTime() - tarefaPrazoAntes.dataPrazo!.getTime()) > 24 * 3600_000)
  const passoPrazoDepois = await passoDe(procPrazo)
  ok("o PhaseWorkflowStepInstance.slaDays também foi atualizado", passoPrazoDepois.slaDays === 10, `${passoPrazoDepois.slaDays}`)

  // ═══ D) remoção segura ═══
  console.log("\nD) remoção — subtarefa nunca tocada é retirada sem conflito")
  const passoRemocaoSeguraDepois = await passoDe(procRemocaoSegura)
  const subsRemocaoSegura = await subtarefasDaEtapa({ stepInstanceId: passoRemocaoSeguraDepois.id })
  ok("a subtarefa intocada não aparece mais (removida da configuração)", subsRemocaoSegura.find((s) => s.key === "sub_intocada") == null)
  const execRemovidaHistorico = await prisma.subtaskExecution.findMany({ where: { stepInstanceId: passoRemocaoSeguraDepois.id, subtaskKey: "sub_intocada" } })
  ok("nenhuma execução histórica existia para apagar (era mesmo pendente)", execRemovidaHistorico.length === 0)

  // ═══ E) remoção com conflito ═══
  console.log("\nE) remoção — subtarefa já tocada gera conflito, nada é aplicado neste processo")
  const rConflitoRemocao = await reconciliarNovaVersaoNaInstanciaAtual({ processoId: procRemocaoConflito, faseMacroKey: FASE_ALVO })
  ok("a reconciliação direta recusa por conflito nomeado (CONFLITO_DADOS_EXISTENTES)",
    rConflitoRemocao.success && !rConflitoRemocao.aplicado && rConflitoRemocao.motivo === "CONFLITO_DADOS_EXISTENTES",
    JSON.stringify(rConflitoRemocao))
  ok("o conflito nomeia a subtarefa específica",
    rConflitoRemocao.success && !rConflitoRemocao.aplicado && rConflitoRemocao.motivo === "CONFLITO_DADOS_EXISTENTES"
    && rConflitoRemocao.conflitos.some((c) => c.subtaskKey === "sub_tocada"))
  const passoConflitoDepois = await passoDe(procRemocaoConflito)
  ok("o passo deste processo continua na versão ANTIGA (nada aplicado pela metade)", passoConflitoDepois.stepDefinitionVersion == null || (passoConflitoDepois.snapshot as any)?.titulo !== "Rótulo EDITADO")
  const execTocadaPreservada = await prisma.subtaskExecution.findFirst({ where: { stepInstanceId: passoConflitoDepois.id, subtaskKey: "sub_tocada" } })
  ok("a execução já registrada da subtarefa tocada continua preservada", execTocadaPreservada != null)

  // ═══ F) passo em execução — edição vira conflito ═══
  console.log("\nF) edição em passo já em execução — conflito, nada aplicado")
  const rConflitoPasso = await reconciliarNovaVersaoNaInstanciaAtual({ processoId: procPassoTocado, faseMacroKey: FASE_ALVO })
  ok("recusa por conflito quando o passo já tem execução real (startedAt preenchido)",
    rConflitoPasso.success && !rConflitoPasso.aplicado && rConflitoPasso.motivo === "CONFLITO_DADOS_EXISTENTES",
    JSON.stringify(rConflitoPasso))
  const passoTocadoDepois = await passoDe(procPassoTocado)
  ok("o rótulo deste passo continua o ORIGINAL (não foi editado sob execução em curso)",
    (passoTocadoDepois.snapshot as any)?.titulo !== "Rótulo EDITADO")

  // ═══ G) preservação de concluídas ═══
  console.log("\nG) preservação de concluídas — nunca reavaliada")
  const passoConcluidoDepois = await passoDe(procConcluido)
  ok("o passo CONCLUÍDO continua CONCLUÍDO", passoConcluidoDepois.status === "CONCLUIDO")
  ok("o rótulo do passo concluído NÃO foi alterado (nunca é reavaliado)",
    (passoConcluidoDepois.snapshot as any)?.titulo !== "Rótulo EDITADO")
  const tarefaConcluidaDepois = await prisma.tarefa.findFirstOrThrow({ where: { workflowStepInstanceId: passoConcluidoInst.id } })
  ok("a Tarefa continua concluída", tarefaConcluidaDepois.concluida === true)

  // ═══ H) isolamento por tipo ═══
  console.log("\nH) isolamento por tipo — publicar no tipo A não alcança o tipo B")
  const passoIsolamentoDepois = await prisma.phaseWorkflowStepInstance.findFirstOrThrow({ where: { processoId: procIsolamento, faseMacroKey: FASE_ALVO, stepKey: "passo_a" } })
  ok("o passo do tipo B continua com o rótulo original dele (nunca alcançado pela publicação do tipo A)",
    (passoIsolamentoDepois.snapshot as any)?.titulo === "Rótulo original (tipo B)", (passoIsolamentoDepois.snapshot as any)?.titulo)

  // ═══ I) repetição sem duplicação ═══
  console.log("\nI) repetição — reconciliar de novo não duplica nem reaplica")
  const rDireto2 = await reconciliarNovaVersaoNaInstanciaAtual({ processoId: procEdicao, faseMacroKey: FASE_ALVO })
  ok("reconciliar de novo devolve SEM_TRABALHO_NOVO (idempotente)",
    rDireto2.success && !rDireto2.aplicado && rDireto2.motivo === "SEM_TRABALHO_NOVO", JSON.stringify(rDireto2))
  const stepsEdicaoDepois = await prisma.phaseWorkflowStepInstance.count({ where: { processoId: procEdicao, faseMacroKey: FASE_ALVO } })
  ok("continua 1 passo (não duplicou)", stepsEdicaoDepois === 1, `${stepsEdicaoDepois}`)
  const tarefasEdicaoDepois = await prisma.tarefa.count({ where: { processoId: procEdicao, workflowStepInstanceId: { not: null } } })
  ok("continua 1 tarefa operacional (não duplicou)", tarefasEdicaoDepois === 1, `${tarefasEdicaoDepois}`)

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
