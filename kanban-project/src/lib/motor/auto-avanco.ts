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

import { prisma } from "@/lib/prisma"
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
  // Alinhar o Workflow Interno V2 é sempre válido, mesmo numa fase HISTÓRICA — é o que
  // permite regularizar depois. Só o AVANÇO é escopado à fase ATUAL: as rotas bespoke
  // (Análise, Apostilamento, Tradução, Retificação, Emissão Retificada) chamam isto com
  // `faseMacroKey` FIXO da própria fase — se essa fase não for mais a atual do processo
  // (materializada como histórica por `preservarHistorico`), concluir o fluxo bespoke
  // dela não pode reavaliar nem mover a fase corrente.
  await concluirWorkflowInternoDaFase(processoId, faseMacroKey)
  await tentarAvancoAutomaticoSeFaseAtual(processoId, faseMacroKey)
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

/**
 * Tenta avançar SÓ quando a unidade concluída pertence à fase ATUAL do processo.
 *
 * Concluir uma tarefa/passo de uma fase HISTÓRICA — regularização manual de uma fase
 * anterior, com o processo já reposicionado numa fase posterior — não pode reavaliar
 * nem mover a fase atual: ela não tem relação com o que acabou de ser concluído. Sem
 * este guard, `tentarAvancoAutomatico` reagiria à fase atual por um evento de outra
 * fase inteiramente — e o processo poderia pular de fase como efeito colateral de uma
 * limpeza histórica que ninguém pediu.
 */
export async function tentarAvancoAutomaticoSeFaseAtual(
  processoId: number | null | undefined,
  faseMacroKeyDaUnidade: string | null | undefined,
  origem = "auto-avanco",
): Promise<void> {
  if (!processoId || !faseMacroKeyDaUnidade) return
  const processo = await prisma.processo
    .findUnique({ where: { id: processoId }, select: { faseAtualKey: true } })
    .catch(() => null)
  if (!processo || processo.faseAtualKey !== faseMacroKeyDaUnidade) return
  await tentarAvancoAutomatico(processoId, origem)
}

/**
 * Mesma trava de `tentarAvancoAutomaticoSeFaseAtual`, para quando quem concluiu foi uma
 * NECESSIDADE documental em vez de uma etapa com fase conhecida na mão (Operação
 * Antecipada, Tarefa Transversal, transição direta de necessidade). Só avança se a
 * necessidade tiver etapa materializada na fase ATUAL do processo — uma necessidade
 * atendida numa fase HISTÓRICA (regularização manual) não reavalia a fase corrente.
 */
export async function tentarAvancoAutomaticoSeNecessidadeDaFaseAtual(
  processoId: number | null | undefined,
  necessidadeId: number | null | undefined,
  origem = "auto-avanco",
): Promise<void> {
  if (!processoId || !necessidadeId) return
  const processo = await prisma.processo
    .findUnique({ where: { id: processoId }, select: { faseAtualKey: true } })
    .catch(() => null)
  if (!processo?.faseAtualKey) return
  const naFaseAtual = await prisma.phaseWorkflowStepInstance
    .findFirst({ where: { necessidadeId, faseMacroKey: processo.faseAtualKey }, select: { id: true } })
    .catch(() => null)
  if (!naFaseAtual) return
  await tentarAvancoAutomatico(processoId, origem)
}
