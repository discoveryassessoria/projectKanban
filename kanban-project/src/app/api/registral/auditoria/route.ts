// GET — trilha de auditoria do motor registral (LogAuditoria, ações registral_*).
import { type NextRequest, NextResponse } from "next/server"
import { listarAuditoria } from "@/src/services/registral/consultas"
import { exigirAlguma } from "@/src/services/registral/autorizacao"

export async function GET(request: NextRequest) {
  const auth = await exigirAlguma(request, ["registral.revisar", "registral.administrar_regras", "usuarios.gerenciar"])
  if (!auth.ok) return auth.resposta

  const q = new URL(request.url).searchParams
  const num = (k: string) => {
    const v = Number.parseInt(q.get(k) ?? "", 10)
    return Number.isFinite(v) && v > 0 ? v : undefined
  }
  const registros = await listarAuditoria({
    entidade: q.get("entidade") ?? undefined,
    entidadeId: num("entidadeId"),
    limite: num("limite"),
  })
  return NextResponse.json({ registros, total: registros.length })
}
