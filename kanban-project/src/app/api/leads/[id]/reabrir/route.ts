// src/app/api/leads/[id]/reabrir/route.ts — desfaz um encerramento; o lead volta para a pessoa (docs/leads-mandato.md, regra 26).
import { NextRequest, NextResponse } from "next/server"
import { reabrirLead } from "@/src/services/leads/atendimento"
import { autorizarLeads, idDaUrl, idInvalido, respostaDeErro } from "@/src/services/leads/rota"

export const dynamic = "force-dynamic"

export async function POST(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { usuario, erro } = await autorizarLeads(request)
  if (erro) return erro
  const id = idDaUrl((await ctx.params).id)
  if (!id) return idInvalido()
  try {
    await reabrirLead({ conversaId: id, autorId: usuario.userId })
    return NextResponse.json({ ok: true })
  } catch (e) {
    return respostaDeErro(e, "POST /api/leads/[id]/reabrir")
  }
}
