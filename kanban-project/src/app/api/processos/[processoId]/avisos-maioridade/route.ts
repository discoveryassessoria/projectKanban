// GET /api/processos/[processoId]/avisos-maioridade
// Pessoas da árvore que completaram 18 anos depois da abertura do processo (ou
// completam nos próximos dias). Derivado na leitura — ver o serviço.
import { NextRequest, NextResponse } from "next/server"
import { verificarPermissao } from "@/src/lib/verificar-permissao"
import { avisosDeMaioridadeDoProcesso } from "@/src/services/genealogia/avisos-maioridade"

export async function GET(request: NextRequest, { params }: { params: Promise<{ processoId: string }> }) {
  const erro = await verificarPermissao(request, "processos.ver")
  if (erro) return erro

  const id = Number.parseInt((await params).processoId, 10)
  if (Number.isNaN(id) || id <= 0) return NextResponse.json({ error: "ID inválido" }, { status: 400 })

  const avisos = await avisosDeMaioridadeDoProcesso(id)
  if (avisos === null) return NextResponse.json({ error: "Processo não encontrado" }, { status: 404 })
  return NextResponse.json({ avisos })
}
