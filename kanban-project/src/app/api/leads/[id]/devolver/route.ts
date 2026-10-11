// src/app/api/leads/[id]/devolver/route.ts — devolve a conversa ao agente (docs/leads-mandato.md, regra 25).
// Se a última palavra é do lead, o agente responde em seguida, depois da resposta desta chamada.
import { after, NextRequest, NextResponse } from "next/server"
import { dependenciasReais, devolverAoAgente, responderConversa } from "@/src/services/leads/atendimento"
import { autorizarLeads, idDaUrl, idInvalido, respostaDeErro } from "@/src/services/leads/rota"

export const dynamic = "force-dynamic"
export const maxDuration = 120

export async function POST(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { usuario, erro } = await autorizarLeads(request)
  if (erro) return erro
  const id = idDaUrl((await ctx.params).id)
  if (!id) return idInvalido()
  try {
    const r = await devolverAoAgente({ conversaId: id, autorId: usuario.userId })
    const deps = r.responderAgora ? dependenciasReais() : null
    if (deps) {
      after(async () => {
        await responderConversa(id, deps).catch((e) => console.error("[leads] falha ao responder depois de devolver:", e instanceof Error ? e.message : e))
      })
    }
    return NextResponse.json(r)
  } catch (e) {
    return respostaDeErro(e, "POST /api/leads/[id]/devolver")
  }
}
