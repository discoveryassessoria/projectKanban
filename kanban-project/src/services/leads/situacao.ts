// src/services/leads/situacao.ts
// ============================================================================
// A SITUAÇÃO DO LEAD — docs/leads-mandato.md, regras 15 e 21.
//
// UMA função para lista, conversa e sino. O banco guarda o FATO (`estado` e as mensagens); a situação
// mostrada é calculada na leitura. Nenhuma tela calcula a sua versão: só desenha o que sai daqui.
// ============================================================================

export const ESTADOS_DO_LEAD = ["AGENTE", "EQUIPE", "ENCERRADA"] as const
export type EstadoDoLead = (typeof ESTADOS_DO_LEAD)[number]

export const AUTORES_DE_MENSAGEM = ["LEAD", "AGENTE", "ATENDENTE"] as const
export type AutorDeMensagem = (typeof AUTORES_DE_MENSAGEM)[number]

export type SituacaoDoLead = "COM_O_AGENTE" | "AGUARDANDO_RESPOSTA" | "RESPONDIDO" | "ENCERRADO"

export const ROTULO_DA_SITUACAO: Record<SituacaoDoLead, string> = {
  COM_O_AGENTE: "Com o agente",
  AGUARDANDO_RESPOSTA: "Aguardando resposta",
  RESPONDIDO: "Respondido",
  ENCERRADO: "Encerrado",
}

/** A janela em que o WhatsApp deixa responder livremente depois da última mensagem do lead. */
export const JANELA_DE_RESPOSTA_MS = 24 * 60 * 60 * 1000

/**
 * PURA. `ultimaDe` é quem escreveu a última mensagem da conversa (ou `null` se não há mensagem).
 * Depois da passagem: se a última palavra é do lead, ou se ninguém respondeu desde a passagem
 * (a última ainda é a frase do agente), o lead está AGUARDANDO RESPOSTA.
 */
export function situacaoDoLead(args: { estado: string; ultimaDe: string | null }): SituacaoDoLead {
  if (args.estado === "ENCERRADA") return "ENCERRADO"
  if (args.estado === "AGENTE") return "COM_O_AGENTE"
  return args.ultimaDe === "ATENDENTE" ? "RESPONDIDO" : "AGUARDANDO_RESPOSTA"
}

/** PURA. Dá para responder a este lead agora? (regra 15) */
export function podeResponderAoLead(args: { estado: string; ultimaDoLeadEm: Date | null; agora: Date }): boolean {
  if (args.estado === "ENCERRADA" || !args.ultimaDoLeadEm) return false
  return args.agora.getTime() - args.ultimaDoLeadEm.getTime() < JANELA_DE_RESPOSTA_MS
}
