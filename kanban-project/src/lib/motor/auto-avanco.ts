// src/lib/motor/auto-avanco.ts
//
// GANCHO ÚNICO do AUTO-AVANÇO por evento — "o card vai sozinho quando finalizar".
//
// Toda mutação que é ENTRADA do gate da fase (computeGate) deve chamar este gancho
// APÓS commitar: conclusão de tarefa/passo, validação de necessidade, alteração de
// requerente/árvore, operação de genealogia. Assim, no instante em que a última
// pendência blocking cai, a fase avança sozinha — sem arrastar o card.
//
// advance() é IDEMPOTENTE e GATED: só avança com zero pendências blocking (a mesma
// fonte oficial computeGate). Portanto é SEGURO chamar liberalmente — se ainda houver
// pendência, não faz nada. Best-effort: NUNCA lança (não pode derrubar a mutação que
// o chamou). Faz um pequeno laço para encadear fases vazias que ficam prontas em
// sequência (limite de segurança evita loop infinito).

import { advance } from "@/src/lib/motor/phase-advance"
import { concluirWorkflowInternoDaFase } from "@/src/services/alinhar-workflow-fase"

const MAX_SALTOS = 5

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

export async function tentarAvancoAutomatico(processoId: number | null | undefined): Promise<void> {
  if (!processoId) return
  try {
    for (let i = 0; i < MAX_SALTOS; i++) {
      const r = (await advance(processoId)) as { success?: boolean; changed?: boolean }
      // avançou uma fase → tenta encadear a próxima (caso já esteja pronta/vazia).
      if (r?.success === true) continue
      break
    }
  } catch (e) {
    console.error(`[auto-avanço] falhou p/ processo ${processoId}:`, e)
  }
}
