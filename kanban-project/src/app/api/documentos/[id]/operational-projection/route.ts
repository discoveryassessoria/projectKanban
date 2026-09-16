// src/app/api/documentos/[id]/operational-projection/route.ts
//
// FONTE ÚNICA do Drawer operacional: agrega, numa resposta consistente, o cabeçalho do
// documento + a projeção operacional oficial (estado/próxima ação/permissões). Substitui
// o duplo fetch concorrente (documento + workflow) que fazia o Drawer piscar
// "Sem operação ativa". Materialização idempotente escopada à fase ativa (não duplica).

import { NextResponse } from "next/server"
import { verificarPermissao } from "@/src/lib/verificar-permissao"
import { resolveDocumentOperationalProjection } from "@/src/lib/process-stage/document-operational-projection"

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  // Gate canônico de LEITURA (mesmo da Central).
  const erro = await verificarPermissao(request, "processos.ver")
  if (erro) return erro

  try {
    const { id } = await params
    const documentId = parseInt(id)
    if (isNaN(documentId)) {
      return NextResponse.json({ error: "ID inválido" }, { status: 400 })
    }

    // ESCOPO EXPLÍCITO DE FASE — a Central Operacional manda a instância da fase que
    // está exibindo (ativa ou "Somente leitura" de uma fase passada) para que o
    // drawer mostre A OPERAÇÃO DAQUELA FASE, não sempre "onde o trabalho está agora".
    const { searchParams } = new URL(request.url)
    const workflowInstanceIdParam = searchParams.get("workflowInstanceId")
    const workflowInstanceId = workflowInstanceIdParam ? parseInt(workflowInstanceIdParam) : null
    const escopoOverride =
      workflowInstanceId != null && !isNaN(workflowInstanceId) ? { workflowInstanceId } : undefined

    const res = await resolveDocumentOperationalProjection(documentId, { escopoOverride })
    if (!res.found) {
      return NextResponse.json({ error: "Documento não encontrado" }, { status: 404 })
    }

    // Resposta ÚNICA e consistente: cabeçalho + projeção + workflow (para o cockpit).
    return NextResponse.json({
      document: res.document,
      projection: res.projection,
      workflow: res.workflow,
    })
  } catch (error) {
    console.error("[GET /api/documentos/[id]/operational-projection]", error)
    return NextResponse.json({ error: "Erro ao resolver projeção do documento" }, { status: 500 })
  }
}
