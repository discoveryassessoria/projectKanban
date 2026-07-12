// src/app/api/processos/[processoId]/pendencias/route.ts
// CP-4E — pendências da fase (somente leitura). Não altera estado.
import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { verificarPermissao } from "@/src/lib/verificar-permissao"
import { calcularPendencias } from "@/src/lib/motor/blocking-engine"

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ processoId: string }> }
) {
  const erro = await verificarPermissao(request, "workflow.avancar")
  if (erro) return erro
  try {
    const { processoId: pid } = await params
    const processoId = parseInt(pid)
    if (isNaN(processoId)) return NextResponse.json({ error: "ID inválido" }, { status: 400 })

    const { searchParams } = new URL(request.url)
    let faseMacroKey = searchParams.get("faseMacroKey")
    if (!faseMacroKey) {
      const proc = await prisma.processo.findUnique({ where: { id: processoId }, select: { faseAtualKey: true } })
      faseMacroKey = proc?.faseAtualKey ?? ""
    }

    const resultado = await calcularPendencias(processoId, faseMacroKey)
    return NextResponse.json(resultado)
  } catch (error) {
    console.error("Erro ao calcular pendências:", error)
    return NextResponse.json({ error: "Erro interno" }, { status: 500 })
  }
}
