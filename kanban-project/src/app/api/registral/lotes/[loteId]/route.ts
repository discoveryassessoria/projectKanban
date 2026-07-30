// GET — progresso e resultado consolidado de um lote registral.
import { type NextRequest, NextResponse } from "next/server"
import { progressoLote } from "@/src/services/registral/lote"
import { erro, exigirAlguma, idDe } from "@/src/services/registral/autorizacao"

export async function GET(request: NextRequest, { params }: { params: Promise<{ loteId: string }> }) {
  const auth = await exigirAlguma(request, ["registral.ver_evidencias", "registral.revisar", "arvore.ver"])
  if (!auth.ok) return auth.resposta

  const { loteId: raw } = await params
  const loteId = idDe(raw)
  if (loteId == null) return erro("loteId inválido")

  const lote = await progressoLote(loteId)
  if (!lote) return erro("Lote não encontrado", 404)
  return NextResponse.json({ lote })
}
