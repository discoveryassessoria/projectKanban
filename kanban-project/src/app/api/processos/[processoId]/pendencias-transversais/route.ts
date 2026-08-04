// src/app/api/processos/[processoId]/pendencias-transversais/route.ts
//
// RESUMO DE PENDÊNCIAS POR FASE — somente leitura, derivado, sem estado próprio.
//
// Responde à pergunta que o Kanban não responde: o que este processo ainda deve, em
// TODAS as fases, independentemente de onde o card está. Mover o processo muda a
// fase operacional de referência; não conclui, não cancela e não dispensa obrigação
// nenhuma — e é aqui que o que continua devido fica visível.

import { NextRequest, NextResponse } from "next/server"
import { verificarPermissao } from "@/src/lib/verificar-permissao"
import { resolvePendenciasTransversais } from "@/src/lib/process-stage/pendencias-transversais"

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ processoId: string }> },
) {
  const erro = await verificarPermissao(request, "processos.ver")
  if (erro) return erro
  try {
    const { processoId: pid } = await params
    const processoId = parseInt(pid)
    if (isNaN(processoId)) return NextResponse.json({ error: "ID inválido" }, { status: 400 })

    const resumo = await resolvePendenciasTransversais(processoId)
    return NextResponse.json(resumo)
  } catch (error) {
    console.error("[pendencias-transversais] falha na leitura:", error)
    return NextResponse.json({ error: "Não foi possível calcular as pendências do processo." }, { status: 500 })
  }
}
