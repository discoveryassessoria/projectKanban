// src/services/leads/whatsapp.ts
// ============================================================================
// A CONVERSA COM A API OFICIAL DO WHATSAPP (Cloud API da Meta) — docs/leads-mandato.md §7.
//
// Envio de texto, "digitando…", download do arquivo que o lead mandou, conferência da assinatura do
// webhook e a leitura do que a Meta entrega. Nada aqui toca o banco: quem grava é `atendimento.ts`.
// ============================================================================
import { createHmac, timingSafeEqual } from "node:crypto"
import type { ConfiguracaoDoWhatsApp } from "./config"

export type Buscar = (url: string, init?: RequestInit) => Promise<Response>

export interface WhatsApp {
  /** Devolve o identificador (`wamid`) da mensagem enviada, quando a Meta o informa. */
  enviarTexto(para: string, texto: string): Promise<string | null>
  /** Marca a mensagem do lead como lida e mostra "digitando…". Nunca lança: é só acabamento. */
  digitando(wamidDoLead: string | null): Promise<void>
  baixarArquivo(midiaId: string): Promise<{ bytes: Buffer; tipo: string }>
}

const TEMPO_LIMITE_MS = 15_000

export function criarWhatsApp(config: ConfiguracaoDoWhatsApp, buscar: Buscar = fetch): WhatsApp {
  const base = `https://graph.facebook.com/${config.versaoApi}`
  const autorizacao = { Authorization: `Bearer ${config.token}` }

  async function chamar(corpo: Record<string, unknown>): Promise<{ messages?: { id?: string }[] }> {
    const resp = await buscar(`${base}/${config.telefoneId}/messages`, {
      method: "POST",
      headers: { ...autorizacao, "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", ...corpo }),
      signal: AbortSignal.timeout(TEMPO_LIMITE_MS),
    })
    if (!resp.ok) {
      const detalhe = await resp.text().catch(() => "")
      throw new Error(`WhatsApp recusou o envio (${resp.status}): ${detalhe.slice(0, 300)}`)
    }
    return (await resp.json().catch(() => ({}))) as { messages?: { id?: string }[] }
  }

  return {
    async enviarTexto(para, texto) {
      const r = await chamar({ recipient_type: "individual", to: para, type: "text", text: { preview_url: false, body: texto } })
      return r.messages?.[0]?.id ?? null
    },

    async digitando(wamidDoLead) {
      if (!wamidDoLead) return
      try {
        await chamar({ status: "read", message_id: wamidDoLead, typing_indicator: { type: "text" } })
      } catch {
        // O "digitando" é só acabamento. Se falhar, a resposta segue normalmente.
      }
    },

    async baixarArquivo(midiaId) {
      const meta = await buscar(`${base}/${midiaId}`, { headers: autorizacao, signal: AbortSignal.timeout(TEMPO_LIMITE_MS) })
      if (!meta.ok) throw new Error(`Arquivo não localizado na Meta (${meta.status})`)
      const { url, mime_type: tipo } = (await meta.json()) as { url?: string; mime_type?: string }
      if (!url) throw new Error("A Meta não informou o endereço do arquivo")
      const arquivo = await buscar(url, { headers: autorizacao, signal: AbortSignal.timeout(TEMPO_LIMITE_MS) })
      if (!arquivo.ok) throw new Error(`Arquivo não baixado da Meta (${arquivo.status})`)
      return { bytes: Buffer.from(await arquivo.arrayBuffer()), tipo: tipo || "application/octet-stream" }
    },
  }
}

/** A Meta assina cada chamada com a chave secreta do aplicativo. Sem isto, qualquer um fingiria ser o WhatsApp. */
export function assinaturaValida(corpoBruto: string | Buffer, assinatura: string | null | undefined, appSecret: string): boolean {
  if (!appSecret || !assinatura || !assinatura.startsWith("sha256=")) return false
  const esperado = createHmac("sha256", appSecret).update(corpoBruto).digest("hex")
  const recebido = assinatura.slice("sha256=".length)
  if (esperado.length !== recebido.length) return false
  return timingSafeEqual(Buffer.from(esperado), Buffer.from(recebido))
}

/** O que o lead mandou, já traduzido do formato da Meta. */
export interface EventoDoLead {
  /** `texto`: o agente lê. `arquivo`: áudio, foto, documento ou vídeo (o agente não lê). `ignorar`: reação, figurinha. */
  tipo: "texto" | "arquivo" | "ignorar"
  wamid: string
  telefone: string
  nome: string
  texto: string
  midiaId: string | null
  /** audio | image | document | video | outro */
  midiaTipo: string | null
  midiaNome: string | null
}

interface MensagemDaMeta {
  id?: string
  from?: string
  type?: string
  text?: { body?: string }
  button?: { text?: string }
  interactive?: { button_reply?: { title?: string }; list_reply?: { title?: string } }
  audio?: { id?: string }
  image?: { id?: string; caption?: string }
  video?: { id?: string; caption?: string }
  document?: { id?: string; caption?: string; filename?: string }
}

interface ValorDaMeta {
  metadata?: { phone_number_id?: string }
  contacts?: { wa_id?: string; profile?: { name?: string } }[]
  messages?: MensagemDaMeta[]
}

/**
 * Transforma o corpo do webhook numa lista simples. Status de entrega e o que não é mensagem ficam de
 * fora. Com `telefoneId`, só entram as mensagens recebidas por ESSE número: o mesmo aplicativo da Meta
 * pode ter outros (o número de teste, por exemplo), e o agente não responde por eles.
 */
export function lerEventos(corpo: unknown, telefoneId?: string): EventoDoLead[] {
  const eventos: EventoDoLead[] = []
  const entradas = (corpo as { entry?: { changes?: { value?: ValorDaMeta }[] }[] } | null)?.entry ?? []
  for (const entrada of entradas) {
    for (const mudanca of entrada.changes ?? []) {
      const valor = mudanca.value ?? {}
      if (telefoneId && valor.metadata?.phone_number_id !== telefoneId) continue
      const nomes = new Map((valor.contacts ?? []).map((c) => [c.wa_id ?? "", c.profile?.name ?? ""]))
      for (const m of valor.messages ?? []) {
        if (!m.id || !m.from) continue
        const evento: EventoDoLead = { tipo: "arquivo", wamid: m.id, telefone: m.from, nome: nomes.get(m.from) ?? "", texto: "", midiaId: null, midiaTipo: "outro", midiaNome: null }
        if (m.type === "text") {
          evento.tipo = "texto"
          evento.texto = m.text?.body ?? ""
          evento.midiaTipo = null
        } else if (m.type === "button") {
          evento.tipo = "texto"
          evento.texto = m.button?.text ?? ""
          evento.midiaTipo = null
        } else if (m.type === "interactive") {
          evento.tipo = "texto"
          evento.texto = m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title ?? ""
          evento.midiaTipo = null
        } else if (m.type === "audio") {
          evento.midiaId = m.audio?.id ?? null
          evento.midiaTipo = "audio"
        } else if (m.type === "image" || m.type === "video" || m.type === "document") {
          const midia = m[m.type]
          evento.midiaId = midia?.id ?? null
          evento.midiaTipo = m.type
          evento.midiaNome = m.type === "document" ? (m.document?.filename ?? null) : null
          evento.texto = midia?.caption ?? ""
        } else if (m.type === "reaction" || m.type === "sticker") {
          evento.tipo = "ignorar"
          evento.midiaTipo = null
        }
        eventos.push(evento)
      }
    }
  }
  return eventos
}
