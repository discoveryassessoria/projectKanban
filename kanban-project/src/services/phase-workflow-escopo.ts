// src/services/phase-workflow-escopo.ts
//
// PURO (sem prisma/sem I/O). Responde a UMA pergunta, e só a partir da configuração
// publicada: quais INSTÂNCIAS de passo a fase deve ter?
//
// O princípio: o workflow cadastrado manda. O escopo de cada passo e o modo de
// execução do workflow são valores PERSISTIDOS no cadastro oficial — nunca inferidos
// por nome de fase, nome de passo, posição, texto ou condição improvisada. Este módulo
// traduz essa configuração em alvos concretos; quem escreve no banco não decide nada.

import {
  ordenarStepsDeterministico,
  estadoInicialPasso,
  type DefStep,
  type EscopoPasso,
  type ModoExecucaoPassos,
  type WorkflowValidationIssue,
} from "./phase-workflow-helpers"

/** Entidades do processo que podem servir de alvo a um passo escopado. */
export interface ContextoEscopo {
  /** Pessoas do processo (escopo PESSOA). Vazio ⇒ passo PESSOA não materializa. */
  pessoaIds: number[]
  /** Necessidades documentais aplicáveis (escopo DOCUMENTO). */
  necessidadeIds: number[]
  /** Documentos já materializados por necessidade (escopo DOCUMENTO). */
  documentoIdPorNecessidade: Map<number, number>
}

/** Uma instância a criar: o passo publicado + a entidade do seu escopo. */
export interface AlvoDePasso {
  def: DefStep
  escopo: EscopoPasso
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
 * Traduz (passos publicados + modo de execução + contexto) em alvos de instância.
 *
 * SEQUÊNCIA (item 11/12 da especificação): quem decide é `execucao`, persistido no
 * workflow. SEQUENCIAL ⇒ só a MENOR ordem nasce DISPONIVEL e cada passo depende do
 * anterior; PARALELO ⇒ todos nascem DISPONIVEL, sem dependência. Não há regra fixa
 * de sequência no código — trocar o valor no cadastro troca o comportamento.
 *
 * ESCOPO (itens 17-20): GLOBAL ⇒ exatamente 1 instância por fase/ciclo, mesmo sem
 * pessoa classificada e sem necessidade documental. PESSOA ⇒ 1 por pessoa do
 * processo. DOCUMENTO ⇒ 1 por necessidade aplicável (com o Documento vinculado
 * quando já existir). Ausência de entidade NUNCA elimina um passo GLOBAL.
 */
export function planejarMaterializacao(
  steps: DefStep[],
  execucao: ModoExecucaoPassos,
  ctx: ContextoEscopo,
): PlanoDeMaterializacao {
  const ordenados = ordenarStepsDeterministico(steps)
  const avisos: WorkflowValidationIssue[] = []
  const alvos: AlvoDePasso[] = []

  ordenados.forEach((def, i) => {
    // Dependência derivada do MODO configurado, não da posição em si.
    const deps = execucao === "SEQUENCIAL" && i > 0 ? [ordenados[i - 1].key] : []
    const status = estadoInicialPasso(deps.length > 0)
    const base = { def, escopo: def.escopo, status, dependeDeStepKeys: deps }

    if (def.escopo === "PESSOA") {
      if (ctx.pessoaIds.length === 0) {
        avisos.push({
          code: "ESCOPO_SEM_ENTIDADE", stepKey: def.key,
          message: `Passo "${def.key}" tem escopo PESSOA e o processo não tem nenhuma pessoa — nenhuma instância criada.`,
        })
        return
      }
      for (const pessoaId of ctx.pessoaIds) {
        alvos.push({ ...base, pessoaId, necessidadeId: null, documentoId: null })
      }
      return
    }

    if (def.escopo === "DOCUMENTO") {
      if (ctx.necessidadeIds.length === 0) {
        avisos.push({
          code: "ESCOPO_SEM_ENTIDADE", stepKey: def.key,
          message: `Passo "${def.key}" tem escopo DOCUMENTO e o processo não tem necessidade documental aplicável — nenhuma instância criada.`,
        })
        return
      }
      for (const necessidadeId of ctx.necessidadeIds) {
        alvos.push({
          ...base, pessoaId: null, necessidadeId,
          documentoId: ctx.documentoIdPorNecessidade.get(necessidadeId) ?? null,
        })
      }
      return
    }

    // GLOBAL — uma instância compartilhada da fase/ciclo. Não depende de pessoa,
    // necessidade, documento, tarefa anterior nem progresso.
    alvos.push({ ...base, pessoaId: null, necessidadeId: null, documentoId: null })
  })

  return { alvos, avisos }
}
