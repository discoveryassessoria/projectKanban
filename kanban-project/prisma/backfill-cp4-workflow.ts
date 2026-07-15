// prisma/backfill-cp4-workflow.ts
// CP-4G — BACKFILL do runtime v2 (Workflow/Passo/Tarefa/Necessidade/Documento).
//
// ⚠️ DRY-RUN OBRIGATÓRIO. Este script NÃO deve rodar em banco real neste checkpoint.
// Por padrão dryRun=true e NADA é escrito. A escrita real exige DUPLA trava:
//   - passar { dryRun: false } explicitamente E
//   - variável de ambiente BACKFILL_EXECUTE="1".
// Mesmo assim, escreve SOMENTE em models/campos NOVOS (v2). NUNCA altera
// Workflow/WorkflowStep/Tarefa legado. Idempotente por chaves determinísticas.
// Reversível pelos campos novos (nenhum destrutivo). NÃO vincula por nome/label
// isolado; tudo ambíguo é preservado em unresolvedCount/breakdown.

import { prisma } from "@/lib/prisma"
import { Prisma } from "@prisma/client"
import {
  RelatorioBackfill,
  resolverProcessoDoWorkflow,
  resolverDefinicaoInterna,
  resolverStepDefinition,
  resolverPassoDaTarefa,
  type BackfillReport,
} from "./backfill-cp4-helpers"
import { montarChaveWorkflow, montarChavePasso } from "../src/services/phase-workflow-helpers"
import { faseCodeToPhaseKey, resolveStepKeyCompat } from "../src/lib/process-stage/fases-catalog"
import { mapLegacyStepStatus, mapLegacyWorkflowStatus } from "../src/lib/process-stage/legacy-status-map"
import type { StepInstanceStatus } from "@prisma/client"

export interface BackfillOptions {
  dryRun?: boolean
  processoId?: number // limitar o escopo (usado pela ativação por processo)
}

/**
 * Estado operacional de DOMÍNIO de um passo legado (certidão/cartório/logística/
 * financeiro) → objeto para metadata.operacao, com as MESMAS chaves do legado
 * (sem renome — diretriz 9) e omitindo nulos (lean). Campos UNIVERSAIS (status,
 * responsável, prazo, datas, motivo) NÃO entram aqui — viram colunas do passo.
 * Retorna null quando não há nada de domínio a preservar.
 */
function montarOperacaoMetadata(st: {
  externalProtocol?: string | null; trackingCode?: string | null; requestChannel?: string | null
  reviewResult?: string | null; validationResult?: string | null; externalEntityName?: string | null
  costPaid?: unknown; paymentMethod?: string | null; documentMedium?: string | null
  physicalLocation?: string | null; reviewChecklist?: unknown; stepObservation?: string | null
  legalOpinion?: string | null; notes?: string | null; completedById?: number | null
  completionPolicy?: string | null; weight?: number | null
}): Record<string, unknown> | null {
  const o: Record<string, unknown> = {}
  const put = (k: string, v: unknown) => { if (v !== null && v !== undefined) o[k] = v }
  put("externalProtocol", st.externalProtocol); put("trackingCode", st.trackingCode)
  put("requestChannel", st.requestChannel); put("reviewResult", st.reviewResult)
  put("validationResult", st.validationResult); put("externalEntityName", st.externalEntityName)
  put("costPaid", st.costPaid != null ? String(st.costPaid) : null) // Decimal → string (precisão)
  put("paymentMethod", st.paymentMethod); put("documentMedium", st.documentMedium)
  put("physicalLocation", st.physicalLocation); put("reviewChecklist", st.reviewChecklist)
  put("stepObservation", st.stepObservation); put("legalOpinion", st.legalOpinion)
  put("notes", st.notes); put("completedById", st.completedById)
  put("completionPolicy", st.completionPolicy); put("weight", st.weight)
  return Object.keys(o).length > 0 ? o : null
}

/**
 * Executa (por padrão em DRY-RUN) o mapeamento legado → v2 e retorna o relatório
 * com scannedCount / created* / linked* / skippedCount / unresolvedCount / breakdown.
 */
export async function backfillCp4Workflow(opts: BackfillOptions = {}): Promise<BackfillReport> {
  // DRY-RUN é o default. Só sai do dry-run com dupla trava (código + ambiente).
  const dryRun = opts.dryRun === false && process.env.BACKFILL_EXECUTE === "1" ? false : true
  const rel = new RelatorioBackfill(dryRun)

  // CONTRACT MIGRATION: os models legados Workflow/WorkflowStep foram REMOVIDOS
  // fisicamente. Não há mais estado legado a ler → o backfill/reconciliador é
  // no-op (relatório vazio). O corpo do laço abaixo é preservado como referência
  // histórica da lógica de reconciliação por-documento e NUNCA executa.
  const workflows: Array<Record<string, unknown>> = []

  for (const wf of workflows as Array<Record<string, unknown> & { [k: string]: any }>) {
    rel.scan()

    // 1) Resolver o Processo de forma SEGURA (cadeia é 1:N ⇒ frequentemente ambígua).
    const processosCandidatos: Array<{ id: number; tipoProcessoMotorId: number | null }> = wf.documento?.pessoa?.arvore?.processos ?? []
    const resProc = resolverProcessoDoWorkflow(processosCandidatos.map((p) => p.id))
    if (!resProc.ok) {
      rel.naoResolvido(resProc.motivo, { entityType: "Workflow", entityId: wf.id, detalhe: `${processosCandidatos.length} processos candidatos` })
      rel.pulou()
      continue
    }
    const processo = processosCandidatos.find((p) => p.id === resProc.valor)!

    // 2) Resolver a fase estável do macro (Workflow.faseCode legado NÃO é phaseKey macro).
    //    Sem mapeamento determinístico, a fase fica não resolvida (nunca inferir por label).
    if (!wf.faseCode) {
      rel.naoResolvido("faseNaoResolvida", { entityType: "Workflow", entityId: wf.id, detalhe: "faseCode legado ausente" })
      rel.pulou()
      continue
    }
    // Ponte canônica faseCode(enum, MAIÚSCULO) → phaseKey(estável, banco) via catálogo.
    const faseMacroKey = faseCodeToPhaseKey(wf.faseCode) as string // wf.faseCode garantido não-nulo acima

    // 3) Definição de Workflow Interno correspondente (por fase + tipo do processo).
    const defs = await prisma.phaseInternalWorkflow.findMany({
      where: { phaseKey: faseMacroKey, arquivado: false, active: true, OR: [{ tipoProcessoId: processo.tipoProcessoMotorId }, { tipoProcessoId: null }] },
      select: { id: true, versao: true },
    })
    const resDef = resolverDefinicaoInterna(defs.map((d) => d.id))
    if (!resDef.ok) {
      rel.naoResolvido(resDef.motivo, { entityType: "Workflow", entityId: wf.id, detalhe: `${defs.length} definições internas candidatas p/ fase ${faseMacroKey}` })
      rel.pulou()
      continue
    }
    const def = defs.find((d) => d.id === resDef.valor)!

    // 4) Fase macro (id/versão) — necessária para snapshot/versionamento.
    const faseMacro = await prisma.faseMacro.findFirst({
      where: { phaseKey: faseMacroKey, macroWorkflow: { tipoProcessoId: processo.tipoProcessoMotorId ?? -1 } },
      select: { id: true, versao: true, macroWorkflow: { select: { id: true, versao: true } } },
    })
    if (!faseMacro) {
      rel.naoResolvido("versaoNaoDeterminavel", { entityType: "Workflow", entityId: wf.id, detalhe: "Fase Macro não resolvida por chave estável" })
      rel.pulou()
      continue
    }

    // Chave idempotente da instância (ciclo 1 = backfill do histórico corrente).
    const ciclo = 1
    const chaveInstancia = montarChaveWorkflow({
      processoId: processo.id, faseMacroId: faseMacro.id, faseMacroKey,
      faseMacroVersion: faseMacro.versao, workflowDefinitionId: def.id, workflowVersion: 1, ciclo,
    })

    // 5) Mapear os passos por stepKey ESTÁVEL contra a definição interna.
    const defSteps = await prisma.phaseInternalWorkflowStep.findMany({ where: { workflowId: def.id }, select: { key: true } })
    const defKeys = defSteps.map((s) => s.key)

    // Documento do Workflow legado — o Workflow legado é POR-DOCUMENTO. O passo v2
    // recebe esse documentoId (camada operacional por-documento no runtime único).
    const documentoId = wf.documentoId

    // Coletar os steps que resolvem com segurança (dry-run só conta; execução criaria).
    // Universal (status/responsável/prazo/datas/motivo) vira campo do passo; domínio
    // (protocolo/canal/devolução/custo/…) vai integral em metadata.operacao (chaves do legado).
    const stepsResolvidos: {
      stepKey: string
      status: StepInstanceStatus
      responsavelId: number | null
      prazo: Date | null
      startedAt: Date | null
      completedAt: Date | null
      motivo: string | null
      papel: string | null
      operacao: Record<string, unknown> | null
    }[] = []
    for (const st of wf.steps) {
      // Compatibilidade determinística: alias legado → passo publicado atual (fonte única no catálogo).
      const chaveAtual = resolveStepKeyCompat(faseMacroKey, st.stepKey)
      const resStep = resolverStepDefinition(chaveAtual, defKeys)
      if (!resStep.ok) {
        rel.naoResolvido(resStep.motivo, { entityType: "WorkflowStep", entityId: st.id, detalhe: `stepKey ${st.stepKey} (→${chaveAtual}) sem definição segura` })
        continue
      }
      // RECONCILIAÇÃO integrada: espelha o STATUS e o estado operacional real do legado.
      stepsResolvidos.push({
        stepKey: chaveAtual,
        status: mapLegacyStepStatus(st.status),
        responsavelId: st.assigneeId ?? null,
        prazo: st.dueAt ?? null,
        startedAt: st.startedAt ?? null,
        completedAt: st.completedAt ?? null,
        motivo: st.motivoBloqueio ?? null,
        papel: st.ownerKey ?? null,
        operacao: montarOperacaoMetadata(st),
      })
    }

    // Status da instância espelha o Workflow legado (fase passada → CONCLUIDO; corrente → ATIVO).
    const instStatus = mapLegacyWorkflowStatus(wf.status)

    if (!dryRun) {
      // ESCRITA REAL (dupla trava): CREATE-OR-RECONCILE idempotente. Instância e passos
      // v2 espelham o ESTADO REAL do legado. Reexecutar apenas reconcilia o status
      // (upsert por chave idempotente) — nunca duplica instância/passo/tarefa.
      await prisma.$transaction(async (tx) => {
        const inst = await tx.phaseWorkflowInstance.upsert({
          where: { chaveIdempotencia: chaveInstancia },
          create: {
            processoId: processo.id, faseMacroKey, faseMacroId: faseMacro.id, faseMacroVersion: faseMacro.versao,
            macroWorkflowId: faseMacro.macroWorkflow.id, macroVersion: faseMacro.macroWorkflow.versao,
            workflowDefinitionId: def.id, workflowVersion: 1, snapshot: { backfill: true } as Prisma.InputJsonValue,
            snapshotSchemaVersion: 1, ciclo, status: instStatus, origem: "MIGRACAO",
            instanciadoPor: "BACKFILL", chaveIdempotencia: chaveInstancia,
          },
          update: { status: instStatus }, // reconcilia instância já migrada
        })
        rel.criouInstancia()
        for (let i = 0; i < stepsResolvidos.length; i++) {
          const p = stepsResolvidos[i]
          // Passo operacional POR-DOCUMENTO: documentoId na chave distingue a mesma
          // stepKey entre documentos sob a mesma instância de fase.
          const chavePasso = montarChavePasso({ workflowInstanceId: inst.id, stepDefinitionId: def.id, stepKey: p.stepKey, stepDefinitionVersion: 1, ciclo, documentoId })
          const metadata = p.operacao ? ({ operacao: p.operacao } as Prisma.InputJsonValue) : undefined
          await tx.phaseWorkflowStepInstance.upsert({
            where: { chaveIdempotencia: chavePasso },
            create: {
              workflowInstanceId: inst.id, stepDefinitionId: def.id, stepDefinitionVersion: 1, stepKey: p.stepKey,
              snapshot: { backfill: true } as Prisma.InputJsonValue, snapshotSchemaVersion: 1,
              processoId: processo.id, faseMacroKey, ordem: i, status: p.status, ciclo, chaveIdempotencia: chavePasso,
              documentoId, // ← camada operacional por-documento
              responsavelId: p.responsavelId, prazo: p.prazo, startedAt: p.startedAt, completedAt: p.completedAt,
              motivo: p.motivo, papel: p.papel, ...(metadata ? { metadata } : {}),
            },
            // Reconcilia o estado operacional real do legado (status + universais + domínio).
            update: {
              status: p.status, responsavelId: p.responsavelId, prazo: p.prazo, startedAt: p.startedAt,
              completedAt: p.completedAt, motivo: p.motivo, papel: p.papel, ...(metadata ? { metadata } : {}),
            },
          })
          rel.criouStep()
        }

        // SUPERSEÇÃO do mapeamento interino (pré-CP-5): passos-template documentoId=null
        // criados por um backfill anterior desta MESMA instância. A verdade agora são os
        // passos POR-DOCUMENTO acima — a conclusão foi preservada neles (não reinicia nem
        // apaga; req 9). Escopo cirúrgico: só backfill-origin (snapshot.backfill=true) e
        // documentoId=null. Nunca toca passos-template instanciados pelo motor.
        if (documentoId != null && stepsResolvidos.length > 0) {
          const sup = await tx.phaseWorkflowStepInstance.updateMany({
            where: {
              workflowInstanceId: inst.id,
              documentoId: null,
              snapshot: { path: ["backfill"], equals: true },
              status: { not: "SUPERSEDIDO" },
            },
            data: { status: "SUPERSEDIDO", supersededAt: new Date() },
          })
          if (sup.count > 0) console.warn(`[backfill CP-5] processo ${processo.id} fase ${faseMacroKey}: ${sup.count} passo(s)-template interino(s) supersedido(s) pela operação por-documento`)
        }
      })
    } else {
      // DRY-RUN: apenas contabiliza o que SERIA criado/reconciliado.
      rel.criouInstancia()
      stepsResolvidos.forEach(() => rel.criouStep())
    }
  }

  // 6) Vínculo de Tarefas legadas a Passos (só quando inequívoco).
  const whereTarefa: Prisma.TarefaWhereInput = {
    workflowStepInstanceId: null,
    ...(opts.processoId ? { processoId: opts.processoId } : {}),
  }
  const tarefas = await prisma.tarefa.findMany({ where: whereTarefa, select: { id: true, processoId: true, faseMacroKey: true } })
  for (const t of tarefas) {
    rel.scan()
    if (t.processoId == null || !t.faseMacroKey) { rel.pulou(); continue }
    const passos = await prisma.phaseWorkflowStepInstance.findMany({
      where: { processoId: t.processoId, faseMacroKey: t.faseMacroKey, tipo: "HUMANO", tarefas: { none: {} } },
      select: { id: true },
    })
    const resPasso = resolverPassoDaTarefa(passos.map((p) => p.id))
    if (!resPasso.ok) {
      rel.naoResolvido(resPasso.motivo, { entityType: "Tarefa", entityId: t.id, detalhe: `${passos.length} passos candidatos` })
      rel.pulou()
      continue
    }
    if (!dryRun) {
      // vínculo é campo NOVO (workflowStepInstanceId) — não altera semântica legada.
      await prisma.tarefa.update({ where: { id: t.id }, data: { workflowStepInstanceId: resPasso.valor } })
    }
    rel.vinculouTarefa()
  }

  return rel.finalizar()
}

// Execução direta (npx tsx prisma/backfill-cp4-workflow.ts) sempre em DRY-RUN.
const executadoDireto = process.argv[1] && /backfill-cp4-workflow\.ts$/.test(process.argv[1])
if (executadoDireto) {
  backfillCp4Workflow({ dryRun: true })
    .then((r) => { console.log(JSON.stringify(r, null, 2)); return prisma.$disconnect() })
    .catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1) })
}
