// src/services/criar-processo.ts
// Criação V2-NATIVA de processos (serviço de domínio ÚNICO e transacional).
//
// Todo processo NOVO nasce direto em runtime "v2", pronto para operar. A cadeia:
//   criar Processo (workflowRuntime="v2")
//   → aplicar Workflow Macro publicado (ativo) do tipo
//   → identificar a 1ª fase válida pela ORDEM (nunca por label/nome)
//   → definir faseAtualKey
//   → instanciar o Workflow Interno da 1ª fase (passos versionados)
//   → gerar as tarefas iniciais UMA única vez (idempotente)
//   → emitir phase.entered inicial (source="process_created")
//   → registrar auditoria de INICIALIZAÇÃO
// TUDO em UMA transação: qualquer falha obrigatória faz rollback integral —
// nunca deixa processo parcial (sem fase, sem workflow interno ou sem tarefas).
//
// Reusa os serviços canônicos (instanciarWorkflowDaFase, garantirTarefaDePasso,
// montarEventoEntered) — NÃO cria um segundo motor e NÃO escreve fase fora daqui.

import { randomUUID } from "crypto"
import { prisma } from "@/lib/prisma"
import type { Prisma } from "@prisma/client"
import { resolveWorkflowRuntime } from "@/src/lib/workflow-runtime"
import { primeiraFasePorOrdem, montarEventoEntered } from "@/src/lib/motor/phase-advance-helpers"
import { instanciarWorkflowDaFase, resolverWorkflowAplicavel } from "@/src/services/phase-workflow"
import { garantirTarefaDePasso } from "@/src/services/passo-tarefa"

export type CriarProcessoFailureCode =
  | "NOME_OBRIGATORIO"
  | "PAIS_INVALIDO"
  | "TIPO_OBRIGATORIO"
  | "TIPO_INVALIDO"
  | "RUNTIME_V2_DESABILITADO"
  | "SEM_MACRO_PUBLICADO"
  | "MACRO_SEM_FASE_INICIAL"
  | "SEM_WORKFLOW_INTERNO"
  | "INSTANCIACAO_FALHOU"
  | "CONFIG_INVALIDA"

export interface CriarProcessoInput {
  nome: string
  pais: string
  tipoProcessoMotorId: number
  descricao?: string | null
  observacoes?: string | null
  arvoreId?: number | null
  previsaoTermino?: string | null // ISO
  contratanteIds?: number[]
  requerenteIds?: number[]
  /** Idempotência: mesma chave ⇒ MESMO processo (sem duplicar em retry/duplo clique). */
  idempotencyKey?: string
  solicitadoPorId?: number
}

export interface CriarProcessoOk {
  success: true
  created: boolean // false = idempotência (processo já existia com a mesma chave)
  processId: number
  processCode: string
  workflowRuntime: "v2"
  currentPhaseKey: string
  currentPhaseInstanceId: number
  workflowMacroVersionId: number
  phaseEnteredEventId: string
  tarefasIniciais: number
  initializationStatus: "INITIALIZED"
  correlationId: string
}

export interface CriarProcessoErr {
  success: false
  code: CriarProcessoFailureCode
  message: string
  correlationId: string
}

export type CriarProcessoResult = CriarProcessoOk | CriarProcessoErr

const MSG: Record<CriarProcessoFailureCode, string> = {
  NOME_OBRIGATORIO: "Nome é obrigatório.",
  PAIS_INVALIDO: "País inválido ou inativo.",
  TIPO_OBRIGATORIO: "Escolha o tipo de processo.",
  TIPO_INVALIDO: "Tipo de processo inválido para este país.",
  RUNTIME_V2_DESABILITADO: "Runtime v2 desabilitado no motor — criação indisponível.",
  SEM_MACRO_PUBLICADO: "O tipo de processo não possui Workflow Macro publicado.",
  MACRO_SEM_FASE_INICIAL: "O Workflow Macro não possui fase inicial ativa.",
  SEM_WORKFLOW_INTERNO: "A fase inicial não possui Workflow Interno configurado.",
  INSTANCIACAO_FALHOU: "Falha ao instanciar o Workflow Interno da fase inicial.",
  CONFIG_INVALIDA: "Configuração mínima do processo ausente ou inválida.",
}

export async function criarProcessoV2(input: CriarProcessoInput): Promise<CriarProcessoResult> {
  const correlationId = randomUUID()
  const err = (code: CriarProcessoFailureCode, message?: string): CriarProcessoErr => ({
    success: false, code, message: message ?? MSG[code], correlationId,
  })

  // ── 1) validações de negócio (antes de qualquer escrita) ──────────────────
  if (!input.nome || !input.nome.trim()) return err("NOME_OBRIGATORIO")
  if (!input.pais || !input.pais.trim()) return err("PAIS_INVALIDO")
  if (!input.tipoProcessoMotorId) return err("TIPO_OBRIGATORIO")

  const paisCat = await prisma.catalogoPais.findFirst({ where: { countryKey: input.pais, ativo: true } })
  if (!paisCat) return err("PAIS_INVALIDO")

  const tipoMotor = await prisma.tipoProcessoNacionalidade.findUnique({ where: { id: input.tipoProcessoMotorId } })
  if (!tipoMotor || tipoMotor.countryKey !== input.pais) return err("TIPO_INVALIDO")

  // Kill switch global: sem v2 habilitado não há como nascer v2.
  const cfg = await prisma.motorConfig.findUnique({ where: { id: 1 }, select: { runtimeV2Habilitado: true } })
  if (resolveWorkflowRuntime("v2", cfg?.runtimeV2Habilitado ?? false) !== "v2") {
    return err("RUNTIME_V2_DESABILITADO")
  }

  // Workflow Macro PUBLICADO (ativo) + fases.
  const wf = await prisma.macroWorkflow.findUnique({
    where: { tipoProcessoId: tipoMotor.id },
    include: { fases: { orderBy: { ordem: "asc" }, select: { phaseKey: true, ordem: true } } },
  })
  if (!wf || !wf.ativo) return err("SEM_MACRO_PUBLICADO")
  if (wf.fases.length === 0) return err("MACRO_SEM_FASE_INICIAL")

  const primeiraFase = primeiraFasePorOrdem(wf.fases)
  if (!primeiraFase) return err("MACRO_SEM_FASE_INICIAL")

  // Workflow Interno aplicável à 1ª fase é OBRIGATÓRIO no motor Discovery.
  const resolvido = await resolverWorkflowAplicavel(tipoMotor.id, primeiraFase)
  if ("erro" in resolvido) return err("SEM_WORKFLOW_INTERNO")

  // ── 2) idempotência: mesma chave ⇒ devolve o processo já criado ────────────
  const chaveCriacao = input.idempotencyKey?.trim()
    ? `criar|${input.idempotencyKey.trim()}`
    : `criar|${correlationId}`

  if (input.idempotencyKey?.trim()) {
    const existente = await prisma.processo.findUnique({
      where: { chaveIdempotenciaCriacao: chaveCriacao },
      select: { id: true, nome: true, faseAtualKey: true, macroWorkflowVersion: true },
    })
    if (existente) return await montarRespostaExistente(existente.id, chaveCriacao, correlationId)
  }

  const occurredAt = new Date().toISOString()

  // ── 3) transação atômica de nascimento ────────────────────────────────────
  try {
    const out = await prisma.$transaction(async (tx) => {
      const processo = await tx.processo.create({
        data: {
          nome: input.nome.trim(),
          descricao: input.descricao?.trim() || null,
          observacoes: input.observacoes?.trim() || null,
          pais: input.pais,
          faseAtualKey: primeiraFase, // estado inicial do agregado (não é transição)
          arvoreId: input.arvoreId || null,
          previsaoTermino: input.previsaoTermino ? new Date(input.previsaoTermino) : null,
          tipoProcessoMotorId: tipoMotor.id,
          workflowRuntime: "v2",
          macroWorkflowVersion: wf.versao,
          chaveIdempotenciaCriacao: chaveCriacao,
        },
        select: { id: true, nome: true },
      })

      if (input.contratanteIds?.length) {
        await tx.processoContratante.createMany({
          data: input.contratanteIds.map((contratanteId) => ({ processoId: processo.id, contratanteId })),
          skipDuplicates: true,
        })
      }
      if (input.requerenteIds?.length) {
        await tx.processoRequerente.createMany({
          data: input.requerenteIds.map((requerenteId) => ({ processoId: processo.id, requerenteId })),
          skipDuplicates: true,
        })
      }

      // 3.1) instanciar o Workflow Interno da 1ª fase (passos versionados). Vê o
      //      Processo recém-criado por ler via tx (instanciar usa txExterno).
      const inst = await instanciarWorkflowDaFase(
        {
          processoId: processo.id, faseMacroKey: primeiraFase, ciclo: 1, origem: "MOTOR",
          correlationId, causationId: chaveCriacao, solicitadoPorId: input.solicitadoPorId,
        },
        tx,
      )
      if (!inst.success) {
        const e = new Error("INSTANCIACAO_FALHOU") as Error & { __instFail?: string }
        e.__instFail = inst.code
        throw e
      }

      // 3.2) tarefas iniciais — UMA vez por passo elegível (serviço idempotente).
      let tarefasIniciais = 0
      for (const step of inst.stepInstances) {
        const g = await garantirTarefaDePasso(
          { stepInstanceId: step.id, correlationId, causationId: chaveCriacao, origem: "process_created", solicitadoPorId: input.solicitadoPorId },
          tx,
        )
        if (g.success && g.created) tarefasIniciais++
      }

      // 3.3) phase.entered INICIAL — mesma infra dos eventos de transição.
      const evt = montarEventoEntered({
        processoId: processo.id,
        faseAnteriorKey: "", // nascimento: não há fase anterior
        faseAnteriorInstanceId: null,
        faseNovaKey: primeiraFase,
        faseNovaInstanceId: inst.workflowInstance.id,
        ciclo: 1,
        operacao: "AVANCAR", // placeholder; transitionReason abaixo o sobrepõe
        origem: "process_created",
        solicitadoPorId: input.solicitadoPorId ?? null,
        macroVersion: wf.versao,
        chaveTransicao: chaveCriacao,
        correlationId,
        occurredAt,
        transitionReason: "initial_phase",
      })
      await tx.domainOutbox.create({
        data: {
          tipo: evt.tipo, aggregateType: "Processo", aggregateId: processo.id,
          correlationId, causationId: chaveCriacao, chaveIdempotencia: evt.chaveIdempotencia,
          payload: evt.payload as Prisma.InputJsonValue,
        },
      })

      // 3.4) auditoria de INICIALIZAÇÃO (não é "avanço de fase" comum).
      await tx.logAuditoria.create({
        data: {
          acao: "PROCESSO_INICIALIZADO_V2", entidade: "PROCESSO", entidadeId: processo.id,
          descricao: "Processo criado — inicialização V2 (primeira fase + Workflow Interno + tarefas iniciais)",
          usuarioId: input.solicitadoPorId ?? null,
          detalhes: {
            runtime: "v2", primeiraFase, macroWorkflowVersion: wf.versao,
            workflowInstanceId: inst.workflowInstance.id, tarefasIniciais,
            phaseEnteredEventId: evt.eventId, idempotencyKey: chaveCriacao, correlationId,
          } as Prisma.InputJsonValue,
        },
      })

      const ok: CriarProcessoOk = {
        success: true, created: true, processId: processo.id, processCode: `#${processo.id}`,
        workflowRuntime: "v2", currentPhaseKey: primeiraFase,
        currentPhaseInstanceId: inst.workflowInstance.id, workflowMacroVersionId: wf.versao,
        phaseEnteredEventId: evt.eventId, tarefasIniciais, initializationStatus: "INITIALIZED",
        correlationId,
      }
      return ok
    }, { timeout: 20000, maxWait: 10000 })
    return out
  } catch (e) {
    const ex = e as { code?: string; __instFail?: string }
    // Idempotência sob corrida: outra requisição com a MESMA chave criou o processo.
    if (ex.code === "P2002") {
      const existente = await prisma.processo.findUnique({
        where: { chaveIdempotenciaCriacao: chaveCriacao }, select: { id: true },
      })
      if (existente) return await montarRespostaExistente(existente.id, chaveCriacao, correlationId)
    }
    if (ex.__instFail) return err("INSTANCIACAO_FALHOU", `${MSG.INSTANCIACAO_FALHOU} (${ex.__instFail})`)
    throw e
  }
}

/** Resposta idempotente: reconstrói o retorno a partir de um processo já criado. */
async function montarRespostaExistente(
  processoId: number, chaveCriacao: string, correlationId: string,
): Promise<CriarProcessoResult> {
  const proc = await prisma.processo.findUnique({
    where: { id: processoId },
    select: { id: true, faseAtualKey: true, macroWorkflowVersion: true },
  })
  if (!proc) return { success: false, code: "CONFIG_INVALIDA", message: MSG.CONFIG_INVALIDA, correlationId }
  const inst = await prisma.phaseWorkflowInstance.findFirst({
    where: { processoId, faseMacroKey: proc.faseAtualKey ?? "", status: { in: ["ATIVO", "BLOQUEADO", "AGUARDANDO"] } },
    orderBy: { ciclo: "desc" }, select: { id: true },
  })
  const tarefas = await prisma.tarefa.count({ where: { processoId } })
  return {
    success: true, created: false, processId: proc.id, processCode: `#${proc.id}`,
    workflowRuntime: "v2", currentPhaseKey: proc.faseAtualKey ?? "",
    currentPhaseInstanceId: inst?.id ?? 0, workflowMacroVersionId: proc.macroWorkflowVersion ?? 0,
    phaseEnteredEventId: `evt|entered|${chaveCriacao}`, tarefasIniciais: tarefas,
    initializationStatus: "INITIALIZED", correlationId,
  }
}
