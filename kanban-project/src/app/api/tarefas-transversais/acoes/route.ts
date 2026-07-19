// src/app/api/tarefas-transversais/acoes/route.ts
// GET: ações de catálogo selecionáveis para a Tarefa Transversal (por fase de referência).
// Sem ?faseCode → todas as fases operacionais (exceto a genealogia/atual, decidido no front).
import { NextRequest, NextResponse } from "next/server"
import { verificarPermissao } from "@/src/lib/verificar-permissao"
import { FASES } from "@/src/lib/process-stage/fases-catalog"
import { acoesDaFase } from "@/src/services/tarefa-transversal"
import type { FaseCode } from "@prisma/client"

export async function GET(request: NextRequest) {
  const erro = await verificarPermissao(request, "processos.ver")
  if (erro) return erro
  const faseCode = new URL(request.url).searchParams.get("faseCode") as FaseCode | null
  const fases = faseCode ? (FASES[faseCode] ? [faseCode] : []) : (Object.keys(FASES) as FaseCode[])
  const resultado = fases.map((fc) => ({
    faseCode: fc,
    faseLabel: FASES[fc].label,
    acoes: acoesDaFase(fc),
  })).filter((f) => f.acoes.length > 0)
  return NextResponse.json({ fases: resultado })
}
