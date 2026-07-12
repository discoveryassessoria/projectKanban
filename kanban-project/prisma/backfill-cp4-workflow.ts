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

export interface BackfillOptions {
  dryRun?: boolean
  processoId?: number // limitar o escopo (usado pela ativação por processo)
}

/**
 * Executa (por padrão em DRY-RUN) o mapeamento legado → v2 e retorna o relatório
 * com scannedCount / created* / linked* / skippedCount / unresolvedCount / breakdown.
 */
export async function backfillCp4Workflow(opts: BackfillOptions = {}): Promise<BackfillReport> {
  // DRY-RUN é o default. Só sai do dry-run com dupla trava (código + ambiente).
  const dryRun = opts.dryRun === false && process.env.BACKFILL_EXECUTE === "1" ? false : true
  const rel = new RelatorioBackfill(dryRun)

  // Escopo: um processo (ativação) ou todos os workflows legados.
  const whereWf: Prisma.WorkflowWhereInput = opts.processoId
    ? { documento: { pessoa: { arvore: { processos: { some: { id: opts.processoId } } } } } }
    : {}

  const workflows = await prisma.workflow.findMany({
    where: whereWf,
    include: {
      steps: { orderBy: { ordem: "asc" } },
      documento: { select: { id: true, pessoa: { select: { arvore: { select: { processos: { select: { id: true, tipoProcessoMotorId: true } } } } } } } },
    },
  })

  for (const wf of workflows) {
    rel.scan()

    // 1) Resolver o Processo de forma SEGURA (cadeia é 1:N ⇒ frequentemente ambígua).
    const processosCandidatos = wf.documento?.pessoa?.arvore?.processos ?? []
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
    const faseMacroKey = String(wf.faseCode) // identidade estável candidata

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

    // Idempotência: se a instância já existe (backfill re-executado), não recria.
    const jaExiste = await prisma.phaseWorkflowInstance.findUnique({ where: { chaveIdempotencia: chaveInstancia }, select: { id: true } })
    if (jaExiste) { rel.pulou(); continue }

    // 5) Mapear os passos por stepKey ESTÁVEL contra a definição interna.
    const defSteps = await prisma.phaseInternalWorkflowStep.findMany({ where: { workflowId: def.id }, select: { key: true } })
    const defKeys = defSteps.map((s) => s.key)

    // Coletar os steps que resolvem com segurança (dry-run só conta; execução criaria).
    const stepsResolvidos: { stepKey: string }[] = []
    for (const st of wf.steps) {
      const resStep = resolverStepDefinition(st.stepKey, defKeys)
      if (!resStep.ok) {
        rel.naoResolvido(resStep.motivo, { entityType: "WorkflowStep", entityId: st.id, detalhe: `stepKey ${st.stepKey} sem definição segura` })
        continue
      }
      stepsResolvidos.push({ stepKey: st.stepKey })
    }

    if (!dryRun) {
      // ESCRITA REAL (dupla trava): cria a instância + passos v2 (models novos apenas).
      await prisma.$transaction(async (tx) => {
        const inst = await tx.phaseWorkflowInstance.create({
          data: {
            processoId: processo.id, faseMacroKey, faseMacroId: faseMacro.id, faseMacroVersion: faseMacro.versao,
            macroWorkflowId: faseMacro.macroWorkflow.id, macroVersion: faseMacro.macroWorkflow.versao,
            workflowDefinitionId: def.id, workflowVersion: 1, snapshot: { backfill: true } as Prisma.InputJsonValue,
            snapshotSchemaVersion: 1, ciclo, status: "ATIVO", origem: "MIGRACAO",
            instanciadoPor: "BACKFILL", chaveIdempotencia: chaveInstancia,
          },
        })
        rel.criouInstancia()
        for (let i = 0; i < stepsResolvidos.length; i++) {
          const sk = stepsResolvidos[i].stepKey
          const chavePasso = montarChavePasso({ workflowInstanceId: inst.id, stepDefinitionId: def.id, stepKey: sk, stepDefinitionVersion: 1, ciclo })
          await tx.phaseWorkflowStepInstance.create({
            data: {
              workflowInstanceId: inst.id, stepDefinitionId: def.id, stepDefinitionVersion: 1, stepKey: sk,
              snapshot: { backfill: true } as Prisma.InputJsonValue, snapshotSchemaVersion: 1,
              processoId: processo.id, faseMacroKey, ordem: i, status: "PENDENTE", ciclo, chaveIdempotencia: chavePasso,
            },
          })
          rel.criouStep()
        }
      })
    } else {
      // DRY-RUN: apenas contabiliza o que SERIA criado.
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
