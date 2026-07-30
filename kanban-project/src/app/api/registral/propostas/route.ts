// GET — fila de propostas de reconciliação (o que aguarda decisão humana).
import { type NextRequest, NextResponse } from "next/server"
import { listarPropostas } from "@/src/services/registral/consultas"
import { exigirAlguma } from "@/src/services/registral/autorizacao"

type Status = "PENDENTE" | "APROVADA" | "REJEITADA" | "ADIADA" | "APLICADA" | "REVERTIDA" | "ABORTADA"
type Criticidade = "AUTOMATICA" | "APROVACAO_HUMANA" | "BLOQUEIO"

const STATUS_VALIDOS = new Set<Status>([
  "PENDENTE", "APROVADA", "REJEITADA", "ADIADA", "APLICADA", "REVERTIDA", "ABORTADA",
])
const CRITICIDADES_VALIDAS = new Set<Criticidade>(["AUTOMATICA", "APROVACAO_HUMANA", "BLOQUEIO"])

export async function GET(request: NextRequest) {
  const auth = await exigirAlguma(request, ["registral.revisar", "registral.aprovar", "registral.ver_evidencias"])
  if (!auth.ok) return auth.resposta

  const q = new URL(request.url).searchParams
  const num = (k: string) => {
    const v = Number.parseInt(q.get(k) ?? "", 10)
    return Number.isFinite(v) && v > 0 ? v : undefined
  }
  const lista = <T>(k: string, validos: Set<T>): T[] | undefined => {
    const raw = q.get(k)
    if (!raw) return undefined
    const itens = raw.split(",").map((s) => s.trim()) as T[]
    const filtrados = itens.filter((i) => validos.has(i))
    return filtrados.length ? filtrados : undefined
  }

  const propostas = await listarPropostas({
    processoId: num("processoId"),
    loteId: num("loteId"),
    status: lista<Status>("status", STATUS_VALIDOS),
    criticidade: lista<Criticidade>("criticidade", CRITICIDADES_VALIDAS),
    limite: num("limite"),
  })
  return NextResponse.json({ propostas, total: propostas.length })
}
