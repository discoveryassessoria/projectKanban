// src/app/api/leads/[id]/route.ts — um lead aberto: conversa, ficha, linhagem e resumo (docs/leads-mandato.md, regras 23 e 24). Somente leitura.
import { NextRequest, NextResponse } from "next/server"
import { lerLead } from "@/src/services/leads/leitura"
import { autorizarLeads, idDaUrl, idInvalido, respostaDeErro } from "@/src/services/leads/rota"

export const dynamic = "force-dynamic"

export async function GET(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { erro } = await autorizarLeads(request)
  if (erro) return erro
  const id = idDaUrl((await ctx.params).id)
  if (!id) return idInvalido()
  try {
    const lead = await lerLead(id)
    if (!lead) return NextResponse.json({ error: "Lead não encontrado.", codigo: "NAO_ENCONTRADO" }, { status: 404 })
    return NextResponse.json({ lead })
  } catch (e) {
    return respostaDeErro(e, "GET /api/leads/[id]")
  }
}
