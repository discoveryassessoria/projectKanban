// src/lib/process-stage/canais-solicitacao.ts
//
// CANAIS DE SOLICITAÇÃO — configuração oficial, PURA e compartilhada.
//
// A lista de canais e o que cada um exige viviam dentro do componente do editor:
// o servidor aceitava qualquer coisa e a validação era só de tela. Agora a
// configuração é uma só, o servidor valida por ela, e o editor recebe a mesma
// configuração no DTO — o que a tela exige e o que a rota aceita não podem
// divergir.
//
// OBRIGATORIEDADE DO PROTOCOLO É POR CANAL, não regra fixa. CRC e e-cartório
// devolvem número no envio; e-mail e WhatsApp podem não devolver nada na hora;
// Correios trabalha com rastreio. Exigir protocolo sempre era o que fazia o
// operador inventar número — ou perder o requerimento já enviado.

import type { CanalSolicitacaoDocumento } from "@prisma/client"

export interface ConfigCanal {
  canal: CanalSolicitacaoDocumento
  label: string
  descricao: string
  /** O canal devolve número de protocolo no ato do envio? */
  protocoloObrigatorio: boolean
  /** Rótulo do comprovante que o canal exige. null = anexo opcional. */
  anexoObrigatorioLabel: string | null
  /** Exige código de rastreio (transporte físico). */
  rastreioObrigatorio: boolean
  /** Exige observação operacional (quem atendeu, guichê, horário). */
  observacaoObrigatoria: boolean
}

export const CANAIS_SOLICITACAO: ConfigCanal[] = [
  {
    canal: "CRC",
    label: "CRC Nacional",
    descricao: "Central Nacional de Registro Civil — integração eletrônica",
    protocoloObrigatorio: true,
    anexoObrigatorioLabel: "Print do protocolo CRC",
    rastreioObrigatorio: false,
    observacaoObrigatoria: false,
  },
  {
    canal: "ECARTORIO",
    label: "E-cartório",
    descricao: "Portal eletrônico do cartório",
    protocoloObrigatorio: true,
    anexoObrigatorioLabel: "PDF do pedido eletrônico",
    rastreioObrigatorio: false,
    observacaoObrigatoria: false,
  },
  {
    canal: "EMAIL",
    label: "E-mail",
    descricao: "Pedido por e-mail direto ao cartório",
    // O cartório pode responder com o número depois — e o requerimento enviado
    // não pode ser perdido só porque o número ainda não chegou.
    protocoloObrigatorio: false,
    anexoObrigatorioLabel: "Requerimento PDF enviado",
    rastreioObrigatorio: false,
    observacaoObrigatoria: false,
  },
  {
    canal: "WHATSAPP",
    label: "WhatsApp",
    descricao: "WhatsApp Business do cartório",
    protocoloObrigatorio: false,
    anexoObrigatorioLabel: "Screenshot da conversa",
    rastreioObrigatorio: false,
    observacaoObrigatoria: false,
  },
  {
    canal: "BALCAO",
    label: "Balcão",
    descricao: "Atendimento presencial",
    protocoloObrigatorio: false,
    anexoObrigatorioLabel: "Comprovante de protocolo (papel digitalizado)",
    rastreioObrigatorio: false,
    observacaoObrigatoria: true,
  },
  {
    canal: "COMUNE",
    label: "Comune italiana",
    descricao: "Pedido direto à comune (Itália)",
    protocoloObrigatorio: false,
    anexoObrigatorioLabel: "PEC enviada ou modulo richiesta",
    rastreioObrigatorio: false,
    observacaoObrigatoria: false,
  },
  {
    canal: "CORREIOS",
    label: "Correios",
    descricao: "Envio físico com rastreamento",
    protocoloObrigatorio: false,
    anexoObrigatorioLabel: "Comprovante de postagem",
    rastreioObrigatorio: true,
    observacaoObrigatoria: false,
  },
  {
    canal: "CONSULADO",
    label: "Consulado",
    descricao: "Pedido protocolado no consulado",
    protocoloObrigatorio: true,
    anexoObrigatorioLabel: "Comprovante do protocolo consular",
    rastreioObrigatorio: false,
    observacaoObrigatoria: false,
  },
]

const POR_CANAL = new Map(CANAIS_SOLICITACAO.map((c) => [c.canal, c]))

export function configDoCanal(canal: CanalSolicitacaoDocumento): ConfigCanal | undefined {
  return POR_CANAL.get(canal)
}

/**
 * Converte a chave textual usada historicamente (Documento.canal_solicitacao e
 * `metadata.operacao.requestChannel`) para o valor do domínio. Ponte de migração:
 * é o que permite ler o que já está gravado sem reescrever registro antigo.
 */
const ALIAS_LEGADO: Record<string, CanalSolicitacaoDocumento> = {
  crc: "CRC",
  "e-cartorio": "ECARTORIO",
  ecartorio: "ECARTORIO",
  "e_cartorio": "ECARTORIO",
  email: "EMAIL",
  "e-mail": "EMAIL",
  whatsapp: "WHATSAPP",
  balcao: "BALCAO",
  comune: "COMUNE",
  comune_italiana: "COMUNE",
  correios: "CORREIOS",
  consulado: "CONSULADO",
}

export function canalDoTexto(valor: string | null | undefined): CanalSolicitacaoDocumento | null {
  if (!valor) return null
  const bruto = String(valor).trim()
  if (POR_CANAL.has(bruto as CanalSolicitacaoDocumento)) return bruto as CanalSolicitacaoDocumento
  return ALIAS_LEGADO[bruto.toLowerCase()] ?? null
}

/** Rótulo do canal para exibição. Nunca é a chave crua na tela. */
export function labelDoCanal(canal: CanalSolicitacaoDocumento | null | undefined): string | null {
  if (!canal) return null
  return POR_CANAL.get(canal)?.label ?? null
}

// ── Validação de campos obrigatórios POR CANAL (usada no servidor e na tela) ──

export interface EntradaValidacaoCanal {
  canal: CanalSolicitacaoDocumento
  numeroProtocolo?: string | null
  anexoUrl?: string | null
  codigoRastreio?: string | null
  observacao?: string | null
  destinatarioNome?: string | null
}

/** Códigos de campo faltando. Vazio = pode enviar. */
export function faltamCamposDoCanal(e: EntradaValidacaoCanal): string[] {
  const cfg = POR_CANAL.get(e.canal)
  if (!cfg) return ["CANAL_INVALIDO"]
  const faltando: string[] = []
  if (cfg.protocoloObrigatorio && !(e.numeroProtocolo ?? "").trim()) faltando.push("NUMERO_PROTOCOLO")
  if (cfg.anexoObrigatorioLabel && !(e.anexoUrl ?? "").trim()) faltando.push("REQUERIMENTO")
  if (cfg.rastreioObrigatorio && !(e.codigoRastreio ?? "").trim()) faltando.push("CODIGO_RASTREIO")
  if (cfg.observacaoObrigatoria && !(e.observacao ?? "").trim()) faltando.push("OBSERVACAO")
  if (!(e.destinatarioNome ?? "").trim()) faltando.push("DESTINATARIO")
  return faltando
}

/** Rótulo humano de cada campo que faltou — a tela não traduz código sozinha. */
export const LABEL_CAMPO_FALTANDO: Record<string, string> = {
  CANAL_INVALIDO: "Canal de solicitação",
  NUMERO_PROTOCOLO: "Número do protocolo",
  REQUERIMENTO: "Requerimento enviado (anexo)",
  CODIGO_RASTREIO: "Código de rastreio",
  OBSERVACAO: "Observação do envio",
  DESTINATARIO: "Cartório / destinatário",
}
