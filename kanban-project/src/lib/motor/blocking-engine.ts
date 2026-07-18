// src/lib/motor/blocking-engine.ts
// CP-4E — PhaseBlockingService / BlockingEngine: SOMENTE LEITURA.
// Calcula, de forma determinística, todas as pendências que impedem o avanço.
// NÃO altera Processo/fase/Passo/Tarefa/Necessidade/Documento; não financeiro;
// não ativa runtime. Usa snapshot da instância + estado persistido (não relê o
// template para reinterpretar instâncias já criadas).

import { randomUUID } from "crypto"
import { prisma } from "@/lib/prisma"
import {
  type BlockingIssue, type Policy,
  classificarNecessidade, classificarPasso, classificarTarefa, avaliarPolitica, separar,
} from "@/src/lib/motor/blocking-helpers"
import { itemCatalogosDeCertidao } from "@/src/lib/documentos/natureza-certidao"
import { resolvePassosBloqueantesDaFase } from "@/src/lib/motor/resolve-passos-bloqueantes"

export interface PhaseBlockingResult {
  issues: BlockingIssue[]
  blocking: BlockingIssue[]
  warnings: BlockingIssue[]
  canAdvance: boolean
  policy: Policy
  faseMacroKey: string
  correlationId: string
}

interface SnapshotPasso { exigeEvidencia?: boolean; exigeResponsavel?: boolean; dependencias?: string[] }

export async function calcularPendencias(
  processoId: number,
  faseMacroKey: string,
  ctx: { correlationId?: string } = {}
): Promise<PhaseBlockingResult> {
  const correlationId = ctx.correlationId ?? randomUUID()
  const policy: Policy = "ALL_REQUIRED_COMPLETED"
  const issues: BlockingIssue[] = []
  // Gate da Genealogia: normaliza o casing. Em runtime a faseMacroKey/faseAtualKey
  // é a phaseKey minúscula ("genealogia"); em outros pontos vem o FaseCode
  // ("GENEALOGIA"). Comparar normalizado cobre ambos (bug de casing eliminado).
  const isGenealogia = String(faseMacroKey).toUpperCase() === "GENEALOGIA"

  const processo = await prisma.processo.findUnique({
    where: { id: processoId },
    select: { id: true, arvoreId: true },
  })
  if (!processo) {
    issues.push({ code: "PROCESSO_NAO_ENCONTRADO", category: "INCIDENTE", severity: "BLOCKING", message: "Processo inexistente" })
    return finalizar(issues, policy, faseMacroKey, correlationId)
  }

  // ---- A. NecessidadesDocumentais ----
  const necessidadesRaw = await prisma.necessidadeDocumental.findMany({
    where: { processoId },
    select: { id: true, status: true, obrigatoriedade: true, itemCatalogoId: true },
  })
  // ELEGIBILIDADE ESTRUTURAL: a Genealogia trabalha EXCLUSIVAMENTE com CERTIDÕES.
  // Qualquer NecessidadeDocumental cuja natureza (do TipoDocumental) não seja
  // CERTIDÃO é IGNORADA aqui — pela classificação estruturada, nunca por texto.
  const certidaoItens = isGenealogia ? await itemCatalogosDeCertidao(prisma) : null
  const necessidades = certidaoItens
    ? necessidadesRaw.filter((n) => certidaoItens.has(n.itemCatalogoId))
    : necessidadesRaw
  if (isGenealogia && necessidades.length === 0) {
    issues.push({ code: "NECESSIDADE_NAO_GERADA", category: "NECESSIDADE_DOCUMENTAL", severity: "BLOCKING", entityType: "Processo", entityId: processoId, message: "Nenhuma NecessidadeDocumental de CERTIDÃO foi gerada na Genealogia", resolutionHint: "Materializar as certidões obrigatórias aplicáveis antes de avançar" })
  }
  // ESCOPO OPERACIONAL da fase: se a fase é operada por DOCUMENTO (há passo vinculado a
  // documentoId na instância ativa), o GATE é o documento — o status da NecessidadeDocumental
  // (escopo NECESSIDADE, cujo ciclo é a Genealogia) NÃO bloqueia esta fase. Consistente com o
  // resolver de passos: nenhuma entidade bloqueia uma fase fora do seu escopo operacional.
  // Sem passo por-documento ainda (fase recém-ativada), a necessidade continua gatando
  // (evita avançar antes de qualquer documento ser trabalhado). Sem hardcode de fase.
  const faseDocumentoScoped = (await prisma.phaseWorkflowStepInstance.count({
    where: { processoId, faseMacroKey, documentoId: { not: null }, status: { notIn: ["SUPERSEDIDO", "CANCELADO"] } },
  })) > 0
  if (!faseDocumentoScoped) {
    for (const n of necessidades) {
      const issue = classificarNecessidade(n.status, n.obrigatoriedade === "OBRIGATORIA", isGenealogia, n.id)
      if (issue) issues.push(issue)
    }
  }

  // ---- Genealogia: estrutura mínima ----
  if (isGenealogia) {
    if (!processo.arvoreId) {
      issues.push({ code: "GENEALOGIA_SEM_ARVORE", category: "INCIDENTE", severity: "BLOCKING", entityType: "Processo", entityId: processoId, message: "Genealogia sem árvore vinculada" })
    }
    const reqs = await prisma.processoRequerente.count({ where: { processoId } })
    if (reqs === 0) {
      issues.push({ code: "GENEALOGIA_SEM_REQUERENTE", category: "REGRA", severity: "BLOCKING", entityType: "Processo", entityId: processoId, message: "Nenhum requerente definido" })
    }
  }

  // ---- B/C/E/F/G/H. Instância v2 da fase + passos + tarefas ----
  const instancia = await prisma.phaseWorkflowInstance.findFirst({
    where: { processoId, faseMacroKey, status: { in: ["ATIVO", "AGUARDANDO", "BLOQUEADO"] } },
    orderBy: { ciclo: "desc" },
    include: {
      steps: {
        include: { tarefas: { where: { chaveIdempotencia: { not: null } } } },
        orderBy: { ordem: "asc" },
      },
    },
  })

  // Mapa necessidadeId → status (fonte oficial da elegibilidade da Genealogia).
  const necStatusById = new Map(necessidadesRaw.map((n) => [n.id, n.status]))

  if (instancia) {
    const stepKeys = new Set(instancia.steps.map((s) => s.stepKey))
    // RESOLVER CANÔNICO por ESCOPO OPERACIONAL (sem hardcode de fase/stepKey): quando a
    // fase é operada por ENTIDADE (há passos com documentoId/necessidadeId), os passos
    // GENÉRICOS (sem entidade) são cópia do template e NÃO bloqueiam. Quando é operada por
    // PROCESSO (todos genéricos), os genéricos SÃO o gate legítimo e bloqueiam.
    const passosGate = resolvePassosBloqueantesDaFase(instancia.steps)
    for (const step of passosGate) {
      const snap = (step.snapshot as SnapshotPasso | null) ?? {}

      // Entidade DISPENSADA não bloqueia (o requisito deixou de ser exigido). Cobre a
      // necessidade DISPENSADA na Genealogia; genérico já foi excluído pelo resolver.
      if (step.necessidadeId != null && necStatusById.get(step.necessidadeId) === "DISPENSADA") continue

      // Passo
      const pIssue = classificarPasso(step.status, step.obrigatorio, step.stepKey, step.id)
      if (pIssue) issues.push(pIssue)

      // Bloqueio manual
      if (step.bloqueadoManual) {
        issues.push({ code: "BLOQUEIO_MANUAL_ATIVO", category: "BLOQUEIO_MANUAL", severity: "BLOCKING", entityType: "step_instance", entityId: step.id, message: `Bloqueio manual ativo no passo ${step.stepKey}`, metadata: { motivo: step.motivo ?? null } })
      }

      // Evidência exigida ausente (sem sistema documental paralelo — usa documentoId)
      if (snap.exigeEvidencia === true && step.documentoId == null && !["CONCLUIDO", "DISPENSADO", "SUPERSEDIDO"].includes(step.status)) {
        issues.push({ code: "EVIDENCIA_OBRIGATORIA_AUSENTE", category: "EVIDENCIA", severity: "BLOCKING", entityType: "step_instance", entityId: step.id, message: `Passo ${step.stepKey} exige evidência ausente` })
      }

      // Dependência quebrada (referencia stepKey inexistente na instância)
      const deps = (step.dependeDeStepKeys as string[] | null) ?? snap.dependencias ?? []
      for (const dep of deps) {
        if (!stepKeys.has(dep)) {
          issues.push({ code: "DEPENDENCIA_QUEBRADA", category: "INCIDENTE", severity: "BLOCKING", entityType: "step_instance", entityId: step.id, message: `Passo ${step.stepKey} depende de stepKey inexistente: ${dep}` })
        }
      }

      // Passo obrigatório humano que deveria ter Tarefa e não tem
      if (step.obrigatorio && step.geraTarefa && step.tipo === "HUMANO" && step.status === "DISPONIVEL" && step.tarefas.length === 0) {
        issues.push({ code: "PASSO_SEM_TAREFA_ESPERADA", category: "INCIDENTE", severity: "WARNING", entityType: "step_instance", entityId: step.id, message: `Passo ${step.stepKey} deveria ter Tarefa e não tem` })
      }

      // Tarefas do passo
      for (const t of step.tarefas) {
        const exigeResp = snap.exigeResponsavel === true
        issues.push(...classificarTarefa(t.statusTarefa, step.obrigatorio, t.responsavelId != null, exigeResp, t.id))
      }
    }
  }

  return finalizar(issues, policy, faseMacroKey, correlationId)
}

function finalizar(issues: BlockingIssue[], policy: Policy, faseMacroKey: string, correlationId: string): PhaseBlockingResult {
  const { blocking, warnings } = separar(issues)
  return { issues, blocking, warnings, canAdvance: avaliarPolitica(issues, policy), policy, faseMacroKey, correlationId }
}
