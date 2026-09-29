// src/lib/process-stage/situacao-solicitacao-certidao.ts
//
// A SITUAÇÃO REAL DO PEDIDO DE UMA CERTIDÃO — 6 estados que refletem o fluxo
// completo Genealogia → Emissão Documental, decidido pelo usuário em produção
// (achado real, processo 651, 28/09/2026): o status bruto de
// NecessidadeDocumental (PENDENTE/EM_ATENDIMENTO/ATENDIDA/NAO_LOCALIZADA/
// DISPENSADA) confundia "localizei o registro na Genealogia" com "recebi a
// certidão do cartório" — as 14 necessidades ATENDIDA do Cibils tinham
// Documento ainda em SOLICITAR/SOLICITADO, nenhuma tinha a certidão em mãos.
//
//   NAO_LOCALIZADA — a Genealogia AINDA NÃO CONCLUIU o passo "Localizar
//     registro" pra essa necessidade — nunca fez sentido perguntar "já
//     solicitei?" antes disso (decisão do usuário, 28/09/2026: "essas tarefas
//     ainda não foram fechadas na fase de Genealogia, então como que elas
//     seriam solicitadas?"). DERIVADO do estado real do passo, não de um botão
//     manual — cobre tanto "ainda nem comecei a procurar" quanto "procurei e
//     não achei" com o MESMO rótulo, porque hoje não existe ação nenhuma na UI
//     que distinga os dois (nenhum botão chama `marcarNaoLocalizada`).
//   NAO_SOLICITADA — registro já localizado, ninguém enviou nada ao cartório.
//   PENDENTE       — o requerimento foi ENVIADO ao cartório, aguardando a
//     confirmação de recebimento.
//   SOLICITADO     — o cartório CONFIRMOU que recebeu o pedido (subtarefa
//     "Receber confirmação do pedido" concluída) — ainda não é a certidão.
//   RECEBIDA       — a certidão (o documento em si) chegou de verdade.
//   DISPENSADA     — a necessidade deixou de se aplicar.
//
// Papel semântico das subtarefas por CHAVE, nunca string solta — mesmo
// princípio de `subtarefa-confirmacao-pedido.ts` (que também documenta por que
// só existe uma key real de "confirmação do pedido" em produção).
export const CHAVES_SUBTAREFA_ENVIO_REQUERIMENTO = ["enviar_requerimento_cartorio"] as const
export const CHAVES_SUBTAREFA_RECEBIMENTO_CERTIDAO = ["receber_certidao"] as const

export { CHAVES_SUBTAREFA_CONFIRMACAO_PEDIDO } from "./subtarefa-confirmacao-pedido"
import { CHAVES_SUBTAREFA_CONFIRMACAO_PEDIDO } from "./subtarefa-confirmacao-pedido"

/** A chave canônica do passo "Localizar registro" na Genealogia. */
export const STEP_KEY_LOCALIZAR_REGISTRO = "localizar_registro"
/** A chave canônica do passo "Solicitar certidão" na Emissão Documental. */
export const STEP_KEY_SOLICITAR_CERTIDAO = "solicitar_certidao"
/** Estados do passo que valem como "localizado" — mesma régua de
 *  central-operacional/route.ts (`CONCLUIDO`/`DISPENSADO` contam; um passo
 *  SUPERSEDIDO já fica de fora da consulta, é ciclo antigo). */
export const STATUS_STEP_LOCALIZADO = ["CONCLUIDO", "DISPENSADO"] as const

export type SituacaoSolicitacaoCertidao =
  | "NAO_LOCALIZADA" | "NAO_SOLICITADA" | "PENDENTE" | "SOLICITADO" | "RECEBIDA" | "DISPENSADA"

export const ROTULO_SITUACAO_SOLICITACAO: Record<SituacaoSolicitacaoCertidao, string> = {
  NAO_LOCALIZADA: "Não localizada",
  NAO_SOLICITADA: "Não solicitada",
  PENDENTE: "Pendente",
  SOLICITADO: "Solicitado",
  RECEBIDA: "Recebida",
  DISPENSADA: "Dispensada",
}

/**
 * Deriva a situação a partir do status da NecessidadeDocumental (só pra
 * DISPENSADA, que é estado TERMINAL — nunca do ATENDIDA/PENDENTE/
 * EM_ATENDIMENTO brutos, que são exatamente o que confundia), de se a
 * Genealogia já concluiu "Localizar registro" pra essa necessidade, e das
 * chaves de subtarefa CONCLUÍDA do passo "Solicitar certidão" (Emissão
 * Documental).
 */
export function situacaoDaSolicitacaoCertidao(input: {
  necessidadeStatus: string
  registroLocalizado: boolean
  chavesConcluidas: readonly string[]
}): SituacaoSolicitacaoCertidao {
  if (input.necessidadeStatus === "DISPENSADA") return "DISPENSADA"
  if (!input.registroLocalizado) return "NAO_LOCALIZADA"
  const concluiu = (chaves: readonly string[]) => chaves.some((c) => input.chavesConcluidas.includes(c))
  if (concluiu(CHAVES_SUBTAREFA_RECEBIMENTO_CERTIDAO)) return "RECEBIDA"
  if (concluiu(CHAVES_SUBTAREFA_CONFIRMACAO_PEDIDO)) return "SOLICITADO"
  if (concluiu(CHAVES_SUBTAREFA_ENVIO_REQUERIMENTO)) return "PENDENTE"
  return "NAO_SOLICITADA"
}
