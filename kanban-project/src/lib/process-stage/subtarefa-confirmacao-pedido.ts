// src/lib/process-stage/subtarefa-confirmacao-pedido.ts
//
// A CHAVE (OU CHAVES) DA SUBTAREFA "RECEBER CONFIRMAÇÃO DO PEDIDO" — o papel
// semântico de "o cartório confirmou que recebeu o requerimento", dentro do
// passo único "Solicitar certidão" (Emissão Documental).
//
// VERIFICADO EM PRODUÇÃO (27/09/2026, rodada "Relatório de Certidões"): o
// histórico do código sugeria três variantes por causa de um script de
// renomeação (`renomear-aguardar-retorno-cartorio.ts`, mandato 19-20/09) cujo
// alvo (`aguardar_retorno_do_cartorio` → `receber_confirmacao_do_pedido`)
// nunca bateu com a StepSubtaskDefinition realmente publicada. Consulta direta
// ao banco confirmou:
//   - StepSubtaskDefinition#130 (step "solicitar_certidao", workflow ativo,
//     Emissão Documental): key = "receber_confirmacao_pedido".
//   - TODAS as 106 linhas de SubtaskExecution deste fluxo, em toda a
//     produção, usam SOMENTE as 4 keys do passo consolidado
//     (enviar_requerimento_cartorio / receber_confirmacao_pedido /
//     receber_certidao / conferir_validar_certidao) — nunca
//     "aguardar_retorno_do_cartorio", "receber_confirmacao_do_pedido" nem
//     "aguardar_retorno_cartorio" (esta última é uma StepSubtaskDefinition
//     REAL, mas de OUTRO step/workflow — "Emitir certidão retificada",
//     id=534 — uma obrigação diferente, nunca usada em produção até aqui).
//
// Mantido como ARRAY (não uma const única) de propósito: se uma versão
// publicada mais antiga um dia reaparecer com outra grafia, o papel
// semântico continua reconhecido em todo lugar que importa daqui — sem caçar
// string espalhada pelo código.
export const CHAVES_SUBTAREFA_CONFIRMACAO_PEDIDO = ["receber_confirmacao_pedido"] as const

export function ehSubtarefaDeConfirmacaoDoPedido(subtaskKey: string | null | undefined): boolean {
  return !!subtaskKey && (CHAVES_SUBTAREFA_CONFIRMACAO_PEDIDO as readonly string[]).includes(subtaskKey)
}
