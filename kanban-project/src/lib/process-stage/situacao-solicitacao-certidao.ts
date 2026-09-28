// src/lib/process-stage/situacao-solicitacao-certidao.ts
//
// A SITUAÇÃO REAL DO PEDIDO DE UMA CERTIDÃO — 6 estados que refletem o fluxo
// operacional de "Solicitar certidão" (Emissão Documental), decidido pelo
// usuário em produção (achado real, processo 651, 28/09/2026): o status bruto
// de NecessidadeDocumental (PENDENTE/EM_ATENDIMENTO/ATENDIDA/NAO_LOCALIZADA/
// DISPENSADA) confundia "localizei o registro na Genealogia" com "recebi a
// certidão do cartório" — as 14 necessidades ATENDIDA do Cibils tinham
// Documento ainda em SOLICITAR/SOLICITADO, nenhuma tinha a certidão em mãos.
//
//   NAO_LOCALIZADA — a Genealogia pesquisou e não achou o registro civil
//     (pior que "não solicitada": nem dá pra pedir ainda). Zero casos reais em
//     produção até 28/09/2026, mas nunca cai no bucket de baixo por omissão —
//     misturar os dois mentiria sobre um caso pior.
//   NAO_SOLICITADA — necessidade existe, ninguém enviou nada ao cartório.
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
 * DISPENSADA/NAO_LOCALIZADA, que são estados TERMINAIS dela — nunca do
 * ATENDIDA/PENDENTE/EM_ATENDIMENTO brutos, que são exatamente o que confundia)
 * e das chaves de subtarefa CONCLUÍDA do passo "Solicitar certidão".
 */
export function situacaoDaSolicitacaoCertidao(input: {
  necessidadeStatus: string
  chavesConcluidas: readonly string[]
}): SituacaoSolicitacaoCertidao {
  if (input.necessidadeStatus === "DISPENSADA") return "DISPENSADA"
  if (input.necessidadeStatus === "NAO_LOCALIZADA") return "NAO_LOCALIZADA"
  const concluiu = (chaves: readonly string[]) => chaves.some((c) => input.chavesConcluidas.includes(c))
  if (concluiu(CHAVES_SUBTAREFA_RECEBIMENTO_CERTIDAO)) return "RECEBIDA"
  if (concluiu(CHAVES_SUBTAREFA_CONFIRMACAO_PEDIDO)) return "SOLICITADO"
  if (concluiu(CHAVES_SUBTAREFA_ENVIO_REQUERIMENTO)) return "PENDENTE"
  return "NAO_SOLICITADA"
}
