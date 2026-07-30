// GET — evidências registrais (documento, página, trecho, método, confiança).
// É a resposta para "por que este dado está confirmado?".
import { type NextRequest, NextResponse } from "next/server"
import { listarEvidencias } from "@/src/services/registral/consultas"
import { exigir } from "@/src/services/registral/autorizacao"
import type { CampoRegistral } from "@/src/lib/genealogia/registral/tipos"

export async function GET(request: NextRequest) {
  const auth = await exigir(request, "registral.ver_evidencias")
  if (!auth.ok) return auth.resposta

  const q = new URL(request.url).searchParams
  const num = (k: string) => {
    const v = Number.parseInt(q.get(k) ?? "", 10)
    return Number.isFinite(v) && v > 0 ? v : undefined
  }

  const evidencias = await listarEvidencias({
    processoId: num("processoId"),
    documentoId: num("documentoId"),
    pessoaId: num("pessoaId"),
    fatoId: num("fatoId"),
    campo: (q.get("campo") as CampoRegistral | null) ?? undefined,
    limite: num("limite"),
  })
  return NextResponse.json({ evidencias, total: evidencias.length })
}
