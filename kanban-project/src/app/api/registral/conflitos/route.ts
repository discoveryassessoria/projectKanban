// GET — conflitos registrais abertos (o que o motor se recusou a decidir).
import { type NextRequest, NextResponse } from "next/server"
import { listarConflitos } from "@/src/services/registral/consultas"
import { exigirAlguma } from "@/src/services/registral/autorizacao"

type StatusConflito = "ABERTO" | "EM_REVISAO" | "RESOLVIDO" | "DESCARTADO"
type Severidade = "CRITICO" | "ALTO" | "MEDIO" | "BAIXO" | "INFO"

const STATUS = new Set<StatusConflito>(["ABERTO", "EM_REVISAO", "RESOLVIDO", "DESCARTADO"])
const SEVERIDADES = new Set<Severidade>(["CRITICO", "ALTO", "MEDIO", "BAIXO", "INFO"])

export async function GET(request: NextRequest) {
  const auth = await exigirAlguma(request, ["registral.revisar", "registral.ver_evidencias"])
  if (!auth.ok) return auth.resposta

  const q = new URL(request.url).searchParams
  const num = (k: string) => {
    const v = Number.parseInt(q.get(k) ?? "", 10)
    return Number.isFinite(v) && v > 0 ? v : undefined
  }
  const lista = <T>(k: string, validos: Set<T>): T[] | undefined => {
    const raw = q.get(k)
    if (!raw) return undefined
    const itens = (raw.split(",").map((s) => s.trim()) as T[]).filter((i) => validos.has(i))
    return itens.length ? itens : undefined
  }

  const conflitos = await listarConflitos({
    processoId: num("processoId"),
    status: lista<StatusConflito>("status", STATUS) ?? ["ABERTO", "EM_REVISAO"],
    severidade: lista<Severidade>("severidade", SEVERIDADES),
    limite: num("limite"),
  })
  return NextResponse.json({ conflitos, total: conflitos.length })
}
