// src/services/passo-tarefa.ts
// CP-4C — serviço CANÔNICO: Passo humano aplicável → 1 Tarefa real.
//
// Reutiliza o model Tarefa. Idempotente, transacional, auditável, versionado
// pelo SNAPSHOT do Passo (nunca relê a definição). NÃO sincroniza, NÃO conclui
// Passo, NÃO avança fase, NÃO gera efeito financeiro, NÃO faz dual-write.
// Regra: gera só quando tipo=HUMANO && geraTarefa=true && status=DISPONIVEL &&
// aplicável ao contexto. Passos não aplicáveis não geram Tarefa.

import { randomUUID } from "crypto"
import { prisma } from "@/lib/prisma"
import type { Tarefa, Prisma } from "@prisma/client"
import { resolveWorkflowRuntime } from "@/src/lib/workflow-runtime"
import {
  type FailureCodeC,
  type TarefaGenIssue,
  TASK_ROLE_PADRAO,
  mapearPrioridade,
  calcularPrazo,
  resolverResponsavel,
  passoGeraTarefa,
} from "@/src/services/passo-tarefa-helpers"
import { identidadeDaUnidade, tarefaVivaDaUnidade, TERMINAIS_DA_UNIDADE } from "@/lib/operacional/identidade-da-tarefa"
import { reancorarTarefaNaUnidade } from "@/lib/operacional/tarefa-canonica"
import { nomeDaTarefa } from "@/lib/operacional/nome-da-tarefa"

/**
 * Pré-condições do processo, iguais para TODOS os passos de uma mesma rodada.
 * Quem gera tarefas em lote (avanço de fase, reconciliação) lê UMA vez e repassa —
 * senão cada passo repete duas consultas dentro da transação, e uma fase com muitos
 * alvos estoura o tempo da transação antes de terminar.
 */
export interface PreCondicoesProcesso {
  runtimeV2Habilitado: boolean
  workflowRuntime: string | null
}

/** Lê as pré-condições uma única vez (use no laço de geração em lote). */
export async function carregarPreCondicoes(
  processoId: number,
  db: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<PreCondicoesProcesso> {
  const [processo, cfg] = await Promise.all([
    db.processo.findUnique({ where: { id: processoId }, select: { workflowRuntime: true } }),
    db.motorConfig.findUnique({ where: { id: 1 }, select: { runtimeV2Habilitado: true } }),
  ])
  return {
    runtimeV2Habilitado: cfg?.runtimeV2Habilitado ?? false,
    workflowRuntime: processo?.workflowRuntime ?? null,
  }
}

export interface GarantirTarefaInput {
  stepInstanceId: number
  taskRole?: string
  correlationId?: string
  causationId?: string
  origem?: string
  solicitadoPorId?: number
  /** Pré-condições já lidas pelo chamador (geração em lote). Omitido ⇒ lê aqui. */
  preCondicoes?: PreCondicoesProcesso
}

export type GarantirTarefaResultado =
  | { success: true; created: boolean; tarefa: Tarefa; warnings: TarefaGenIssue[]; correlationId: string }
  | { success: false; code: FailureCodeC; errors: TarefaGenIssue[]; correlationId: string }

interface SnapshotPasso {
  titulo?: string
  descricao?: string | null
  prioridade?: string | null
  sla?: number | null
  aplicavel?: boolean
}

/** Aplicabilidade ao contexto (seam do CP-4E). No 4C: não bloqueado e não
 *  explicitamente marcado inaplicável no snapshot. */
function ehPassoAplicavel(step: { bloqueadoManual: boolean }, snap: SnapshotPasso | null): boolean {
  if (step.bloqueadoManual) return false
  if (snap && snap.aplicavel === false) return false
  return true
}

export async function garantirTarefaDePasso(
  input: GarantirTarefaInput,
  txExterno?: Prisma.TransactionClient
): Promise<GarantirTarefaResultado> {
  const correlationId = input.correlationId ?? randomUUID()
  const taskRole = input.taskRole ?? TASK_ROLE_PADRAO
  const fail = (code: FailureCodeC, errors: TarefaGenIssue[] = []): GarantirTarefaResultado => ({
    success: false, code, errors, correlationId,
  })

  // Sob txExterno, as leituras DEVEM usar a mesma tx para enxergar Passos
  // recém-criados dentro da transação (ex.: instanciação da próxima fase no advance).
  const db = txExterno ?? prisma

  const step = await db.phaseWorkflowStepInstance.findUnique({
    where: { id: input.stepInstanceId },
    include: { workflowInstance: { select: { status: true } } },
  })
  if (!step) return fail("STEP_NAO_ENCONTRADO")

  // runtime v2 + feature flag (reusa a leitura do chamador quando houver)
  const pre = input.preCondicoes ?? (await carregarPreCondicoes(step.processoId, db))
  const v2Global = pre.runtimeV2Habilitado
  if (!v2Global) return fail("RUNTIME_V2_DESABILITADO")
  if (resolveWorkflowRuntime(pre.workflowRuntime, v2Global) !== "v2") return fail("PROCESSO_LEGACY")

  // instância ativa
  if (!["ATIVO", "AGUARDANDO", "BLOQUEADO"].includes(step.workflowInstance.status)) {
    return fail("WORKFLOW_INSTANCE_INATIVA")
  }

  const snap = (step.snapshot as SnapshotPasso | null) ?? null
  const aplicavel = ehPassoAplicavel(step, snap)

  // regra normativa
  const regra = passoGeraTarefa({ tipo: step.tipo, geraTarefa: step.geraTarefa, status: step.status, aplicavel })
  if (!regra.gera) return fail(regra.code!)

  // O NOME DA TAREFA É O DO TRABALHO, NÃO O DA ETAPA.
  //
  // Aqui se lia `snap?.titulo` — o título do PASSO. No desenho antigo isso
  // estava certo, porque a tarefa era o passo. Depois que a identidade passou a
  // ser a unidade de trabalho, sobrou uma tarefa chamada "Solicitar certidão"
  // para um workflow de cinco etapas cujo trabalho é obter uma certidão.
  //
  // A regra agora é a mesma que o reconciliador usa: obrigação → documento →
  // etapa (só se a unidade tiver uma), e a pessoa como qualificador.
  const irmaos = await db.phaseWorkflowStepInstance.count({
    where: {
      workflowInstanceId: step.workflowInstanceId,
      ...(step.necessidadeId != null
        ? { necessidadeId: step.necessidadeId }
        : step.documentoId != null
          ? { documentoId: step.documentoId }
          : { id: step.id }),
    },
  })
  const necessidade = step.necessidadeId != null
    ? await db.necessidadeDocumental.findUnique({
        where: { id: step.necessidadeId },
        select: { pessoaId: true, itemCatalogo: { select: { name: true } } },
      })
    : null
  const documento = step.documentoId != null
    ? await db.documento.findUnique({
        where: { id: step.documentoId },
        select: { descricao: true, pessoaId: true, documentType: { select: { name: true } } },
      })
    : null
  const pessoaId = necessidade?.pessoaId ?? documento?.pessoaId ?? step.pessoaId ?? null
  const pessoa = pessoaId != null
    ? await db.pessoa.findUnique({ where: { id: pessoaId }, select: { nome: true, sobrenome: true } })
    : null
  const titulo = nomeDaTarefa({
    itemDaNecessidade: necessidade?.itemCatalogo?.name ?? null,
    nomeDoDocumento: documento?.documentType?.name ?? documento?.descricao ?? null,
    pessoa: pessoa ? [pessoa.nome, pessoa.sobrenome].filter(Boolean).join(" ") : null,
    tituloDaEtapa: (snap?.titulo as string | undefined) ?? null,
    etapasDaUnidade: irmaos,
  })
  const descricao = snap?.descricao ?? null
  const prioridade = mapearPrioridade(step.prioridade ?? snap?.prioridade)
  const sla = step.slaDays ?? snap?.sla ?? null
  const dataPrazo = calcularPrazo(new Date(), sla)
  const resp = resolverResponsavel({ responsavelId: step.responsavelId, papel: step.papel, equipe: step.equipe, stepKey: step.stepKey })
  const warnings: TarefaGenIssue[] = resp.warning ? [resp.warning] : []

  // A IDENTIDADE DA UNIDADE — normalizada, e a mesma que o reconciliador usa.
  // O passo conhece o trabalho pelo lado dele (às vezes só o documento, às
  // vezes só a necessidade); a normalização resolve o outro lado, para que dois
  // escritores que olham a mesma certidão cheguem à mesma chave.
  // O leitor é o `tx` do chamador quando existe: dentro de uma transação
  // aberta, o cliente global lê fora dela — e o que ele não enxerga vira a
  // segunda tarefa.
  const { chave: chaveTarefa, unidade } = await identidadeDaUnidade(db, {
    processoId: step.processoId, necessidadeId: step.necessidadeId,
    documentoId: step.documentoId, pessoaId: step.pessoaId,
    ciclo: step.ciclo, stepInstanceId: step.id,
  })
  const causationId = input.causationId ?? step.chaveIdempotencia
  const origem = input.origem ?? "workflow"

  // txExterno: compõe DENTRO de uma transação já aberta (ex.: PhaseAdvanceService).
  const corpo = async (tx: Prisma.TransactionClient): Promise<GarantirTarefaResultado> => {
      // A MESMA UNIDADE PODE JÁ TER TAREFA — nesta instância ou em outra.
      //
      // Mudar de fase MOVE o trabalho, não o multiplica: a certidão do Ademir
      // continua sendo a certidão do Ademir depois que a Genealogia foi
      // supersedida pela Emissão Documental. Criar outra aqui foi o que produziu
      // duas tarefas vivas para o documento 2111, ambas com a Daniela.
      //
      // A chave não carrega a fase, de propósito — então ela encontra a tarefa
      // da fase anterior, e o que falta não é criar: é reancorar.
      const porChave = await tx.tarefa.findFirst({ where: { chaveIdempotencia: chaveTarefa } })
      // TAREFA ENCERRADA NÃO RESSUSCITA — e também não bloqueia trabalho novo.
      //
      // Reabrir a fase sobre uma obrigação já cumprida é pedir o trabalho DE
      // NOVO: a certidão foi obtida e agora precisa ser obtida outra vez. Nem
      // reabrir a tarefa fechada (isso apagaria o fato de que ela foi
      // concluída), nem devolver a fechada como se fosse a pendência (o passo
      // novo ficaria sem tarefa, invisível para a fila e para o prazo).
      //
      // Nasce outra, com identidade própria: a mesma unidade, executada sob
      // outro roteiro. O sufixo é determinístico, então repetir a
      // materialização continua não duplicando.
      const jaEncerrada =
        porChave != null
        && TERMINAIS_DA_UNIDADE.includes(porChave.statusTarefa as (typeof TERMINAIS_DA_UNIDADE)[number])
      if (jaEncerrada && porChave!.workflowInstanceId === step.workflowInstanceId) {
        // Mesmo roteiro: é a mesma execução, e ela terminou.
        return { success: true, created: false, tarefa: porChave!, warnings, correlationId }
      }
      const chaveDaExecucao = jaEncerrada
        ? `${chaveTarefa}|reexec${step.workflowInstanceId}`
        : chaveTarefa
      if (jaEncerrada) {
        const jaRefeita = await tx.tarefa.findFirst({ where: { chaveIdempotencia: chaveDaExecucao } })
        if (jaRefeita) return { success: true, created: false, tarefa: jaRefeita, warnings, correlationId }
      }
      const daUnidade = jaEncerrada ? null : porChave ?? await tarefaVivaDaUnidade(tx, unidade)
      if (daUnidade) {
        // Já ancorada neste passo: nada a fazer, e nada a auditar.
        if (daUnidade.workflowStepInstanceId === step.id) {
          const inteira = porChave ?? await tx.tarefa.findUniqueOrThrow({ where: { id: daUnidade.id } })
          return { success: true, created: false, tarefa: inteira, warnings, correlationId }
        }
        const reancorada = await reancorarTarefaNaUnidade(tx, {
          tarefaId: daUnidade.id,
          workflowInstanceId: step.workflowInstanceId,
          workflowStepInstanceId: step.id,
          faseMacroKey: step.faseMacroKey,
          chaveIdempotencia: chaveTarefa,
          necessidadeId: unidade.necessidadeId,
          documentoId: unidade.documentoId,
          pessoaId: unidade.pessoaId,
          deInstanciaId: daUnidade.workflowInstanceId,
          chaveAnterior: daUnidade.chaveIdempotencia,
        })
        return { success: true, created: false, tarefa: reancorada, warnings, correlationId }
      }

      const tarefa = await tx.tarefa.create({
        data: {
          titulo,
          descricao,
          processoId: step.processoId,
          prioridade,
          statusTarefa: "NAO_INICIADA",
          concluida: false,
          dataPrazo,
          responsavelId: resp.responsavelId,
          // vínculos do runtime v2 (papel/equipe permanecem na step instance)
          workflowInstanceId: step.workflowInstanceId,
          workflowStepInstanceId: step.id,
          necessidadeId: step.necessidadeId,
          documentoId: step.documentoId,
          faseMacroKey: step.faseMacroKey,
          ciclo: step.ciclo,
          taskRole,
          origem,
          correlationId,
          chaveIdempotencia: chaveDaExecucao,
        },
      })

      // O EVENTO E O OUTBOX SÃO IDEMPOTENTES PELA CHAVE — e agora respeitam isso.
      //
      // Ambos já declaravam `chaveIdempotencia @unique`, mas escreviam com
      // `create`: a segunda escrita da mesma chave não era ignorada, era um
      // P2002 que derrubava a transação inteira e levava junto a criação da
      // tarefa. Declarar a chave e depois quebrar quando ela repete é ter a
      // idempotência no schema e não no comportamento.
      await tx.workflowEvento.createMany({
        data: [{
          tipo: "TAREFA_GERADA", entityType: "tarefa", entityId: tarefa.id,
          processoId: step.processoId, workflowInstanceId: step.workflowInstanceId,
          stepInstanceId: step.id, tarefaId: tarefa.id,
          correlationId, causationId,
          chaveIdempotencia: `evt|TAREFA_GERADA|${chaveDaExecucao}`,
          dados: { stepKey: step.stepKey, taskRole, ciclo: step.ciclo, prioridade, temResponsavel: resp.responsavelId != null },
        }],
        skipDuplicates: true,
      })
      await tx.domainOutbox.createMany({
        data: [{
          tipo: "tarefa.generated", aggregateType: "Tarefa", aggregateId: tarefa.id,
          correlationId, causationId, chaveIdempotencia: `outbox|tarefa|${chaveDaExecucao}`,
          payload: { processoId: step.processoId, stepInstanceId: step.id, taskRole, ciclo: step.ciclo, tarefaId: tarefa.id },
        }],
        skipDuplicates: true,
      })

      return { success: true, created: true, tarefa, warnings, correlationId }
  }
  try {
    return txExterno ? await corpo(txExterno) : await prisma.$transaction(corpo)
  } catch (e) {
    // Convergência só no modo standalone; sob txExterno, propaga p/ rollback do chamador.
    if (!txExterno && (e as { code?: string })?.code === "P2002") {
      const existente = await prisma.tarefa.findFirst({ where: { chaveIdempotencia: chaveTarefa } })
      if (existente) return { success: true, created: false, tarefa: existente, warnings, correlationId }
    }
    throw e
  }
}
