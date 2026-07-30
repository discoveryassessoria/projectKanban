// PATCH — decide um conflito: resolver | descartar. Append-only, com motivo.
import { type NextRequest, NextResponse } from "next/server"
import { decidirConflito } from "@/src/services/registral/decisoes"
import { erro, exigir, idDe } from "@/src/services/registral/autorizacao"

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ conflitoId: string }> }) {
  const auth = await exigir(request, "registral.revisar")
  if (!auth.ok) return auth.resposta

  const { conflitoId: raw } = await params
  const conflitoId = idDe(raw)
  if (conflitoId == null) return erro("conflitoId inválido")

  const body = await request.json().catch(() => ({}))
  const acao = String(body?.acao ?? "").toLowerCase()
  const motivo = typeof body?.motivo === "string" ? body.motivo.trim() : ""

  if (acao !== "resolver" && acao !== "descartar") {
    return erro("Ação inválida. Use: resolver | descartar.")
  }

  const r = await decidirConflito({
    conflitoId,
    ator: auth.ctx.ator,
    decisao: acao === "resolver" ? "RESOLVER_CONFLITO" : "DESCARTAR_CONFLITO",
    motivo,
  })
  return NextResponse.json({ resultado: r }, { status: r.ok ? 200 : 409 })
}
