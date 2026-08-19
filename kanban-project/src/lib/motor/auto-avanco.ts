// src/lib/motor/auto-avanco.ts
//
// GANCHO ÚNICO do AUTO-AVANÇO por evento — "o card vai sozinho quando finalizar".
//
// Toda mutação que é ENTRADA do gate da fase (computeGate) deve chamar este gancho
// APÓS commitar: conclusão de tarefa/passo, validação de necessidade, alteração de
// requerente/árvore, operação de genealogia. Assim, no instante em que a última
// pendência blocking cai, a fase avança sozinha — sem arrastar o card.
//
// A DECISÃO E O LAÇO MORAM NO RECONCILIADOR (`reconciliar-motor-fases.ts`), que é gateado
// pelo mesmo `computeGate` e explica o motivo quando não avança. Aqui ficou só o
// gancho: uma porta fina, best-effort, que nunca lança — não pode derrubar a mutação
// que a chamou. Duas implementações do mesmo laço seria a segunda fonte de verdade
// que esta arquitetura não admite.

import { reconciliarMotorDeFases } from "@/src/lib/motor/reconciliar-motor-fases"
import { concluirWorkflowInternoDaFase } from "@/src/services/alinhar-workflow-fase"

/**
 * Conclusão de uma fase por-processo (fluxo bespoke): alinha o Workflow Interno V2 da fase
 * (conclui os passos obrigatórios abertos → libera o gate) e então AVANÇA automaticamente.
 * É o gancho para "todas as fases avançam sozinhas ao concluir" nas fases bespoke, sem
 * bypassar o gate (o gate é liberado pela conclusão canônica dos passos). Best-effort.
 */
export async function concluirFaseBespokeEAvancar(
  processoId: number | null | undefined,
  faseMacroKey: string | null | undefined,
): Promise<void> {
  if (!processoId || !faseMacroKey) return
  await concluirWorkflowInternoDaFase(processoId, faseMacroKey)
  await tentarAvancoAutomatico(processoId)
}

export async function tentarAvancoAutomatico(
  processoId: number | null | undefined,
  origem = "auto-avanco",
): Promise<void> {
  if (!processoId) return
  // O reconciliador já é best-effort e não lança; o try aqui é a segunda cinta de
  // segurança para um erro de import/infra, que também não pode derrubar o chamador.
  try {
    await reconciliarMotorDeFases(processoId, { origem })
  } catch (e) {
    console.error(`[auto-avanço] falhou p/ processo ${processoId}:`, e)
  }
}
