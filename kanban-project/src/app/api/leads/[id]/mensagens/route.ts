// src/app/api/leads/[id]/mensagens/route.ts — a pessoa responde ao lead pela tela (docs/leads-mandato.md, regras 15 e 16).
// A resposta sai pelo WhatsApp do agente; a partir dela a conversa é da pessoa e o agente não fala mais.
import { NextRequest, NextResponse } from "next/server"
import { dependenciasReais, responderComoPessoa } from "@/src/services/leads/atendimento"
import { autorizarLeads, idDaUrl, idInvalido, respostaDeErro, whatsAppDesligado } from "@/src/services/leads/rota"

export const dynamic = "force-dynamic"
export const maxDuration = 30

export async function POST(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { usuario, erro } = await autorizarLeads(request)
  if (erro) return erro
  const id = idDaUrl((await ctx.params).id)
  if (!id) return idInvalido()
  const deps = dependenciasReais()
  if (!deps) return whatsAppDesligado()
  try {
    const corpo = await request.json().catch(() => ({}))
    const mensagem = await responderComoPessoa({ conversaId: id, texto: String(corpo?.texto ?? ""), autorId: usuario.userId }, deps)
    return NextResponse.json({ mensagem }, { status: 201 })
  } catch (e) {
    return respostaDeErro(e, "POST /api/leads/[id]/mensagens")
  }
}
