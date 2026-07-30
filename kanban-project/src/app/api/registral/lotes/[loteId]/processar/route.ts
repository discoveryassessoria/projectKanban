// POST — drena mais um ciclo do lote (retomada após falha/timeout).
import { type NextRequest, NextResponse } from "next/server"
import { processarLote } from "@/src/services/registral/lote"
import { erro, exigir, idDe } from "@/src/services/registral/autorizacao"

export async function POST(request: NextRequest, { params }: { params: Promise<{ loteId: string }> }) {
  const auth = await exigir(request, "registral.reprocessar")
  if (!auth.ok) return auth.resposta

  const { loteId: raw } = await params
  const loteId = idDe(raw)
  if (loteId == null) return erro("loteId inválido")

  const body = await request.json().catch(() => ({}))
  const limite = Number.isFinite(Number(body?.limite)) ? Number(body.limite) : undefined

  try {
    const resultado = await processarLote({ loteId, limite, usuarioId: auth.ctx.usuarioId })
    return NextResponse.json({ resultado })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error("[registral][processar]", msg)
    return erro(msg, 422)
  }
}
