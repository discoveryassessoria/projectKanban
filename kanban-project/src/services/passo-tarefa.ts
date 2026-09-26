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
import { SELECT_UNIAO_PARA_TITULAR, titularDaUniao } from "@/src/services/genealogia/titular-uniao"
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
import { reconciliarObrigacaoDeAtribuicao } from "@/lib/operacional/obrigacao-atribuicao"
import { definicaoHistoricaDoPasso } from "@/src/services/versao-publicada"

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
        select: {
          pessoaId: true,
          uniao: { select: SELECT_UNIAO_PARA_TITULAR },
          itemCatalogo: { select: { name: true } },
        },
      })
    : null
  const documento = step.documentoId != null
    ? await db.documento.findUnique({
        where: { id: step.documentoId },
        select: { descricao: true, pessoaId: true, documentType: { select: { name: true } } },
      })
    : null
  // Certidão de casamento é sujeita da UNIÃO (pessoaId nulo por desenho) — sem
  // este fallback a tarefa nascia sem pessoa e sem nome no título (achado real
  // 24/09/2026: "Certidão de Casamento - Inteiro Teor" aparecia na fila de
  // distribuição sem dizer de quem era). O titular é o cônjuge da linha de
  // transmissão — ver titular-uniao.ts.
  const pessoaId =
    necessidade?.pessoaId ?? titularDaUniao(necessidade?.uniao) ?? documento?.pessoaId ?? step.pessoaId ?? null
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
  // O PRAZO PODE NASCER NUMA SUBTAREFA, NÃO NA CRIAÇÃO (mandato "motor de
  // prazo/acompanhamento/cobrança", 25/09/2026) — quando o passo tem
  // ALGUMA subtarefa marcada `definePrazoDaTarefa` (ex.: "Receber
  // certidão", na Emissão Documental), a Tarefa nasce com `dataPrazo: null`
  // de propósito; `aplicarPrazoDaTarefaSeConfigurado`
  // (subtarefas-da-etapa.ts) grava o valor real quando aquela subtarefa
  // virar corrente — nunca aqui, nunca do `slaDays` do passo. Sem nenhuma
  // subtarefa configurada assim, o comportamento é o de sempre (prazo já na
  // criação, a partir do SLA do passo).
  const historico = await definicaoHistoricaDoPasso(step.id, db)
  const algumaSubtarefaDefinePrazo = historico?.passo.subtarefas.some((s) => s.definePrazoDaTarefa) ?? false
  const dataPrazo = algumaSubtarefaDefinePrazo ? null : calcularPrazo(new Date(), sla)
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
      // MESMO ROTEIRO não basta — precisa ser o MESMO PASSO. Uma necessidade
      // dispensada e depois reativada (achado real 24/09/2026: Isonia/Atahualpa,
      // processo Cibils) cancela o passo antigo e materializa um passo NOVO —
      // mesma workflowInstance, StepInstance diferente. Sem o segundo `&&`, a
      // tarefa cancelada do passo antigo era devolvida como se fosse a
      // pendência do passo novo: a exigência voltava a valer, mas a tarefa
      // continuava cancelada e invisível pra fila — a certidão nunca aparecia
      // pra ninguém assumir.
      if (jaEncerrada && porChave!.workflowInstanceId === step.workflowInstanceId && porChave!.workflowStepInstanceId === step.id) {
        // Mesmo passo, mesma execução: é a mesma tentativa, e ela terminou.
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
          // `pessoaId` (não `unidade.pessoaId`): a variável local já passou
          // pelo fallback de casamento (`titularDaUniao`) que
          // `normalizarUnidade` não conhece — mesma correção do `create` acima.
          pessoaId,
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
          // A MESMA `pessoaId` que já resolvia o TÍTULO (necessidade → união →
          // documento → passo) nunca chegava à COLUNA — achado real 24/09/2026:
          // o título dizia "· Ignacio Cibils", mas `Tarefa.pessoaId` ficava
          // `null` pra sempre, e toda projeção que lê a coluna (Minha
          // Operação, Distribuição) mostrava "—" na Pessoa mesmo com o nome
          // certo no documento/tarefa.
          pessoaId,
          faseMacroKey: step.faseMacroKey,
          // O CICLO DA OBRIGAÇÃO — o MESMO que a chave de identidade carrega.
          //
          // Aqui era `step.ciclo`, o ciclo da FASE. Os dois só coincidem
          // enquanto ninguém volta de fase: na reexecução a chave dizia `c1`
          // (ciclo da necessidade) e a coluna guardava `2` (ciclo da instância),
          // e a busca canônica — que filtrava pela coluna — deixava de achar a
          // própria tarefa que acabara de nascer.
          ciclo: unidade.ciclo,
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

      // OBRIGAÇÃO ADMINISTRATIVA — a Tarefa pode ter nascido sem responsável
      // (`resp.responsavelId` nulo). Reconcilia AGORA, na mesma transação: se
      // é a primeira sem dono deste processo, abre "Atribuir tarefas — X"; se
      // já havia obrigação aberta, o contador dela é lido na apresentação, sem
      // escrita aqui. Ver lib/operacional/obrigacao-atribuicao.ts.
      await reconciliarObrigacaoDeAtribuicao(tx, step.processoId)

      return { success: true, created: true, tarefa, warnings, correlationId }
  }
  try {
    // timeout maior que o padrão (5s) — mesma causa real de phase-workflow.ts:
    // RTT até o banco pooled já estourou esta transação por distância pura.
    const resultado = txExterno ? await corpo(txExterno) : await prisma.$transaction(corpo, { timeout: 15_000 })
    // MATERIALIZA AS SUBTAREFAS DA TAREFA NOVA — mandato "motor de prazo/
    // acompanhamento/cobrança", 25/09/2026. FORA da transação, de propósito
    // (mesma invariante de `concluirSubtarefaCorrentePeloPasso`: as
    // primitivas de subtarefa usam o `prisma` cru, chamar dentro do `tx`
    // violaria transação×conexão). Só no caminho STANDALONE (`!txExterno`)
    // — sob uma transação externa (ex.: avanço de fase em lote), o
    // chamador dela é quem materializa depois que A PRÓPRIA transação dele
    // comita, mesmo padrão; não fizemos isso ainda em todo chamador de
    // `txExterno` — gap conhecido, não deste mandato, não escondido.
    // Best-effort: uma falha aqui não desfaz a Tarefa já criada (ela existe
    // de qualquer forma; a subtarefa 1 fica materializada na próxima leitura
    // via `subtarefasDaEtapa`, que já calcula o estado sem depender de
    // execução persistida — só o ACOMPANHAMENTO "a iniciar" fica pra depois).
    if (!txExterno && resultado.success && resultado.created && resultado.tarefa.workflowStepInstanceId != null) {
      const stepInstanceId = resultado.tarefa.workflowStepInstanceId
      const { materializarSubtarefas } = await import("@/src/services/subtarefas-da-etapa")
      await materializarSubtarefas({ stepInstanceId }).catch((e) => {
        console.error(`materializarSubtarefas falhou para stepInstanceId=${stepInstanceId} (Tarefa ${resultado.tarefa.id} já foi criada; subtarefas ficam pendentes de reconciliação):`, e)
      })
    }
    return resultado
  } catch (e) {
    // Convergência só no modo standalone; sob txExterno, propaga p/ rollback do chamador.
    if (!txExterno && (e as { code?: string })?.code === "P2002") {
      const existente = await prisma.tarefa.findFirst({ where: { chaveIdempotencia: chaveTarefa } })
      if (existente) return { success: true, created: false, tarefa: existente, warnings, correlationId }
    }
    throw e
  }
}
