// GET /api/arvore/:arvoreid/divergencias-resolvidas — as divergências entre a árvore e o registro que a Genealogia resolveu (o registro venceu). Alimenta a Inteligência da árvore.
import { type NextRequest, NextResponse } from "next/server"
import { verificarPermissao } from "@/src/lib/verificar-permissao"
import { divergenciasResolvidas } from "@/src/services/genealogia/sincronizar-com-registro"

export async function GET(request: NextRequest, { params }: { params: Promise<{ arvoreid: string }> }) {
  const semPermissao = await verificarPermissao(request, "arvore.ver")
  if (semPermissao) return semPermissao
  const arvoreId = Number.parseInt((await params).arvoreid)
  if (!Number.isInteger(arvoreId) || arvoreId <= 0) return NextResponse.json({ error: "ID inválido" }, { status: 400 })
  return NextResponse.json({ divergencias: await divergenciasResolvidas(arvoreId) })
}
