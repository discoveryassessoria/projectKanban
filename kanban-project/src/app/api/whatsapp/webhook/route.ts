// src/app/api/whatsapp/webhook/route.ts
// ============================================================================
// O ENDEREÇO QUE A META CHAMA A CADA MENSAGEM DO WHATSAPP — docs/leads-mandato.md §7 e §8.
//
// ROTA PÚBLICA (caminho exato em `API_PUBLICA`, middleware.ts): quem chama é a Meta, sem login. O que
// autoriza é a própria rota:
//   · GET  — a Meta confere o endereço uma vez, com a senha combinada (`WHATSAPP_VERIFY_TOKEN`);
//   · POST — só vale com a assinatura da Meta (HMAC do corpo com `WHATSAPP_APP_SECRET`).
//
// O POST responde 200 NA HORA (a Meta reenvia tudo se a resposta demorar) e o atendimento continua
// DEPOIS da resposta, com `after()`: espera o lead terminar de escrever, chama a IA e envia as mensagens.
// Nenhuma transação fica aberta nesse tempo. Sem as chaves do WhatsApp, a rota responde "não
// configurado" e nada é gravado (regra 18).
// ============================================================================
import { after, NextRequest, NextResponse } from "next/server"
import { dependenciasReais, receberMensagemDoLead } from "@/src/services/leads/atendimento"
import { configuracaoDoWhatsApp } from "@/src/services/leads/config"
import { assinaturaValida, lerEventos } from "@/src/services/leads/whatsapp"

export const dynamic = "force-dynamic"
// Espera pelo fim da digitação (6 s) + IA + envio com pausas. A trava da conversa dura mais que isto.
export const maxDuration = 120

const naoConfigurado = () => NextResponse.json({ configurado: false }, { status: 503 })

export async function GET(request: NextRequest) {
  const config = configuracaoDoWhatsApp()
  if (!config) return naoConfigurado()
  const sp = new URL(request.url).searchParams
  if (sp.get("hub.mode") !== "subscribe" || sp.get("hub.verify_token") !== config.verifyToken) {
    return new NextResponse("recusado", { status: 403 })
  }
  return new NextResponse(sp.get("hub.challenge") ?? "", { status: 200, headers: { "content-type": "text/plain; charset=utf-8" } })
}

export async function POST(request: NextRequest) {
  const config = configuracaoDoWhatsApp()
  if (!config) return naoConfigurado()

  const bruto = await request.text()
  if (!assinaturaValida(bruto, request.headers.get("x-hub-signature-256"), config.appSecret)) {
    return NextResponse.json({ error: "assinatura inválida" }, { status: 401 })
  }

  let corpo: unknown
  try {
    corpo = JSON.parse(bruto)
  } catch {
    return NextResponse.json({ ok: true }) // assinado, mas ilegível: nada a fazer, e reenviar não muda isso
  }

  // Só as mensagens do número do agente: o mesmo aplicativo da Meta pode ter outros números (o de teste, por exemplo).
  const eventos = lerEventos(corpo, config.telefoneId)
  const deps = eventos.length ? dependenciasReais() : null
  if (deps) {
    after(async () => {
      await Promise.allSettled(
        eventos.map((evento) =>
          receberMensagemDoLead(evento, deps).catch((e) => {
            console.error("[leads] falha ao atender mensagem do WhatsApp:", e instanceof Error ? e.message : e)
          }),
        ),
      )
    })
  }
  return NextResponse.json({ ok: true })
}
