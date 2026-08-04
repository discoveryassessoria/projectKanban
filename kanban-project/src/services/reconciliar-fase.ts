// src/services/reconciliar-fase.ts
//
// RECONCILIAÇÃO da fase ATIVA de um processo — FACHADA do materializador oficial.
//
// Esta função existia como orquestração própria (instanciar + gerar tarefa). Ela
// continua com o mesmo nome e o mesmo contrato para quem já a chama, mas agora não
// tem implementação: delega a `materializarExecucaoDaFase`, o serviço ÚNICO por onde
// TODA materialização passa. Duas orquestrações equivalentes é como o avanço de fase
// e a movimentação manual acabaram produzindo resultados diferentes.
//
// Reconciliar continua sendo CONVERGIR: cria o que falta, recupera o que existe, não
// duplica, não conclui, não avança fase, não cria ciclo, não apaga histórico.

import { materializarExecucaoDaFase } from "@/src/services/materializar-fase"
import type { WorkflowValidationIssue } from "@/src/services/phase-workflow-helpers"

export interface ReconciliarFaseResultado {
  processoId: number
  faseMacroKey: string | null
  ciclo: number | null
  workflowInstanceId: number | null
  passosTotais: number
  passosCriados: number
  tarefasCriadas: number
  avisos: WorkflowValidationIssue[]
  erro: string | null
}

/**
 * Garante que a fase ATIVA do processo tenha as instâncias dos seus passos publicados
 * e as tarefas correspondentes. Idempotente: rodar N vezes gera o mesmo estado.
 */
export async function reconciliarFaseAtiva(
  processoId: number,
  opts: { correlationId?: string; solicitadoPorId?: number } = {},
): Promise<ReconciliarFaseResultado> {
  const r = await materializarExecucaoDaFase({
    processoId,
    fonte: "RECONCILIACAO",
    correlationId: opts.correlationId,
    solicitadoPorId: opts.solicitadoPorId,
  })

  // `erro` continua significando "não deu para materializar": configuração ausente
  // ou inválida. Fase publicada e sem alvo aplicável NÃO é erro — é um estado
  // oficial, e vai como aviso (o chamador decide o que mostrar).
  const erroReal =
    r.estado === "SEM_WORKFLOW_PUBLICADO" ||
    r.estado === "CONFIGURACAO_INVALIDA" ||
    r.estado === "PROCESSO_SEM_FASE" ||
    r.estado === "ERRO"

  return {
    processoId,
    faseMacroKey: r.faseMacroKey,
    ciclo: r.ciclo,
    workflowInstanceId: r.workflowInstanceId,
    passosTotais: r.passosTotais,
    passosCriados: r.passosCriados,
    tarefasCriadas: r.tarefasCriadas,
    avisos: r.motivos,
    erro: erroReal ? (r.mensagemAdministrativa ?? r.motivos[0]?.message ?? "Falha ao materializar a fase.") : null,
  }
}
