// POST /api/coleta/[codigo]/enviar — PÚBLICA. Recebe UMA pessoa (dados + papel + consentimento + arquivos
// já enviados). Resposta mínima: `{ ok: true }` — nunca devolve dado já enviado (docs/coleta-de-dados-mandato.md §2.6).
import { NextResponse } from "next/server"
import { registrarEnvioPublico } from "@/src/services/coleta/coleta-envio"
import { dentroDoLimite, hashDoIp, ipDoRequest } from "@/src/services/coleta/limite"

export const dynamic = "force-dynamic"

export async function POST(req: Request, { params }: { params: Promise<{ codigo: string }> }) {
  const ipHash = hashDoIp(ipDoRequest(req))
  if (!dentroDoLimite(`env:${ipHash}`, 10, 60_000)) {
    return NextResponse.json({ error: "Muitas tentativas. Tente de novo em instantes." }, { status: 429 })
  }
  const { codigo } = await params
  let corpo: Record<string, unknown>
  try { corpo = await req.json() } catch { return NextResponse.json({ error: "Pedido inválido." }, { status: 400 }) }

  const r = await registrarEnvioPublico({ codigo, corpo, ipHash })
  if (r.ok) return NextResponse.json({ ok: true })
  const status = r.code === "LINK_INDISPONIVEL" ? 404 : r.code === "LIMITE" ? 429 : 400
  return NextResponse.json({ error: r.message, ...(r.erros ? { erros: r.erros } : {}) }, { status })
}
