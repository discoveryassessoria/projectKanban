// src/app/api/leads/route.ts — a lista da tela de Leads (docs/leads-mandato.md, regras 21 e 22). Somente leitura.
import { NextRequest, NextResponse } from "next/server"
import { listarLeads } from "@/src/services/leads/leitura"
import { autorizarLeads, respostaDeErro } from "@/src/services/leads/rota"
import { ROTULO_DA_SITUACAO, type SituacaoDoLead } from "@/src/services/leads/situacao"

export const dynamic = "force-dynamic"

export async function GET(request: NextRequest) {
  const { erro } = await autorizarLeads(request)
  if (erro) return erro
  try {
    const sp = new URL(request.url).searchParams
    const pedida = sp.get("situacao")
    const situacao = pedida && pedida in ROTULO_DA_SITUACAO ? (pedida as SituacaoDoLead) : null
    return NextResponse.json(await listarLeads({ situacao, busca: sp.get("busca") }))
  } catch (e) {
    return respostaDeErro(e, "GET /api/leads")
  }
}
