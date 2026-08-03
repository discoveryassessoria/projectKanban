// src/services/phase-workflow-escopo.ts
//
// PURO (sem prisma/sem I/O). Responde a UMA pergunta, e só a partir da configuração
// publicada: quais INSTÂNCIAS de passo a fase deve ter?
//
// DOIS CONCEITOS QUE NÃO SE MISTURAM:
//
//  • COMPARTILHAMENTO DO WORKFLOW — `PhaseInternalWorkflow.tipoProcessoId = null`,
//    exibido como "global (compartilhado)". Diz que o MESMO workflow serve a todos
//    os tipos de processo. Não diz nada sobre quantas tarefas a fase gera.
//
//  • CARDINALIDADE OPERACIONAL DO PASSO — quantas instâncias ele gera e presa a QUAL
//    entidade. Vem de `PhaseInternalWorkflowStep.cardinalidade`; quando não declarada,
//    HERDA o escopo operacional canônico da fase (fases-catalog), que é onde a
//    arquitetura já declara que Genealogia opera por NECESSIDADE e Emissão por
//    DOCUMENTO. Nunca inferida por nome, posição ou texto.

import {
  ordenarStepsDeterministico,
  estadoInicialPasso,
  type DefStep,
  type Cardinalidade,
  type ModoExecucaoPassos,
  type WorkflowValidationIssue,
} from "./phase-workflow-helpers"

/** Entidades do processo que podem servir de alvo a um passo. */
export interface ContextoEscopo {
  /** Pessoas do processo (cardinalidade PESSOA). */
  pessoaIds: number[]
  /** Registros/certidões a localizar (cardinalidade NECESSIDADE). */
  necessidadeIds: number[]
  /** Documentos materializados (cardinalidade DOCUMENTO). */
  documentoIds: number[]
  /** Documento já vinculado a cada necessidade, quando existir. */
  documentoIdPorNecessidade: Map<number, number>
}

/** Uma instância a criar: o passo publicado + a entidade do seu alvo. */
export interface AlvoDePasso {
  def: DefStep
  cardinalidade: Cardinalidade
  pessoaId: number | null
  necessidadeId: number | null
  documentoId: number | null
  /** Estado inicial derivado do MODO DE EXECUÇÃO configurado. */
  status: "DISPONIVEL" | "PENDENTE"
  dependeDeStepKeys: string[]
}

export interface PlanoDeMaterializacao {
  alvos: AlvoDePasso[]
  /** Passos publicados que não produziram alvo, com o motivo — nunca silencioso. */
  avisos: WorkflowValidationIssue[]
}

/**
 * Cardinalidade EFETIVA do passo: a declarada no cadastro, ou — quando ausente — a
 * do escopo operacional canônico da fase. Uma única regra, sem exceção por fase.
 */
export function cardinalidadeEfetiva(
  declarada: Cardinalidade | null | undefined,
  escopoDaFase: Cardinalidade,
): Cardinalidade {
  return declarada ?? escopoDaFase
}

/**
 * Traduz (passos publicados + modo de execução + escopo da fase + alvos) em
 * instâncias a criar.
 *
 * SEQUÊNCIA: quem decide é `execucao`, persistido no workflow. SEQUENCIAL ⇒ só a
 * MENOR ordem nasce DISPONIVEL e cada passo depende do anterior; PARALELO ⇒ todos
 * nascem DISPONIVEL. Não há regra fixa de sequência no código.
 *
 * CARDINALIDADE: PROCESSO ⇒ 1 instância por fase/ciclo. PESSOA ⇒ 1 por pessoa.
 * NECESSIDADE ⇒ 1 por registro/certidão a localizar, preservando o vínculo com a
 * pessoa e com o registro. DOCUMENTO ⇒ 1 por documento materializado.
 */
export function planejarMaterializacao(
  steps: DefStep[],
  execucao: ModoExecucaoPassos,
  escopoDaFase: Cardinalidade,
  ctx: ContextoEscopo,
): PlanoDeMaterializacao {
  const ordenados = ordenarStepsDeterministico(steps)
  const avisos: WorkflowValidationIssue[] = []
  const alvos: AlvoDePasso[] = []

  ordenados.forEach((def, i) => {
    // Dependência derivada do MODO configurado, não da posição em si.
    const deps = execucao === "SEQUENCIAL" && i > 0 ? [ordenados[i - 1].key] : []
    const status = estadoInicialPasso(deps.length > 0)
    const cardinalidade = cardinalidadeEfetiva(def.cardinalidade, escopoDaFase)
    const base = { def, cardinalidade, status, dependeDeStepKeys: deps }

    const semAlvo = (o_que: string) =>
      avisos.push({
        code: "CARDINALIDADE_SEM_ALVO", stepKey: def.key,
        message: `Passo "${def.key}" opera por ${cardinalidade} e o processo não tem ${o_que} — nenhuma instância criada.`,
      })

    if (cardinalidade === "PESSOA") {
      if (ctx.pessoaIds.length === 0) return semAlvo("pessoa na árvore")
      for (const pessoaId of ctx.pessoaIds) alvos.push({ ...base, pessoaId, necessidadeId: null, documentoId: null })
      return
    }

    if (cardinalidade === "NECESSIDADE") {
      if (ctx.necessidadeIds.length === 0) return semAlvo("registro/certidão a localizar")
      for (const necessidadeId of ctx.necessidadeIds) {
        alvos.push({
          ...base, pessoaId: null, necessidadeId,
          documentoId: ctx.documentoIdPorNecessidade.get(necessidadeId) ?? null,
        })
      }
      return
    }

    if (cardinalidade === "DOCUMENTO") {
      if (ctx.documentoIds.length === 0) return semAlvo("documento materializado")
      for (const documentoId of ctx.documentoIds) alvos.push({ ...base, pessoaId: null, necessidadeId: null, documentoId })
      return
    }

    // PROCESSO — uma instância da fase/ciclo. Não depende de pessoa, necessidade,
    // documento, tarefa anterior nem progresso.
    alvos.push({ ...base, pessoaId: null, necessidadeId: null, documentoId: null })
  })

  return { alvos, avisos }
}
