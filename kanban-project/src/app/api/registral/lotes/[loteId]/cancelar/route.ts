// POST — cancela um lote em andamento. Nada é apagado: as execuções pendentes
// vão para CANCELADO e o histórico permanece.
import { type NextRequest, NextResponse } from "next/server"
import { cancelarLote } from "@/src/services/registral/lote"
import { erro, exigir, idDe } from "@/src/services/registral/autorizacao"

export async function POST(request: NextRequest, { params }: { params: Promise<{ loteId: string }> }) {
  const auth = await exigir(request, "registral.reprocessar")
  if (!auth.ok) return auth.resposta

  const { loteId: raw } = await params
  const loteId = idDe(raw)
  if (loteId == null) return erro("loteId inválido")

  const body = await request.json().catch(() => ({}))
  const motivo = typeof body?.motivo === "string" ? body.motivo.trim() : ""
  if (!motivo) return erro("Cancelar exige motivo escrito.")

  const r = await cancelarLote({ loteId, usuarioId: auth.ctx.usuarioId, motivo })
  return NextResponse.json({ resultado: r })
}
