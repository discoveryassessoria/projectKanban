// GET — métricas de observabilidade do motor registral (agregadas por hora).
import { type NextRequest, NextResponse } from "next/server"
import { listarMetricas } from "@/src/services/registral/consultas"
import { exigirAlguma } from "@/src/services/registral/autorizacao"

export async function GET(request: NextRequest) {
  const auth = await exigirAlguma(request, ["registral.administrar_regras", "registral.revisar", "usuarios.gerenciar"])
  if (!auth.ok) return auth.resposta

  const q = new URL(request.url).searchParams
  const dias = Number.parseInt(q.get("dias") ?? "7", 10)
  const desde = new Date(Date.now() - (Number.isFinite(dias) && dias > 0 ? dias : 7) * 86400000)
  const limiteRaw = Number.parseInt(q.get("limite") ?? "", 10)

  const metricas = await listarMetricas({
    escopo: q.get("escopo") ?? undefined,
    desde,
    limite: Number.isFinite(limiteRaw) && limiteRaw > 0 ? limiteRaw : undefined,
  })
  return NextResponse.json({ metricas, total: metricas.length, desde })
}
