// POST — reprocessa o documento desta execução. Cria um lote novo só com ele; o
// histórico anterior permanece intacto e as evidências não duplicam.
import { type NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { processarLote, reprocessarDocumento } from "@/src/services/registral/lote"
import { erro, exigir, idDe } from "@/src/services/registral/autorizacao"

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ execucaoId: string }> },
) {
  const auth = await exigir(request, "registral.reprocessar")
  if (!auth.ok) return auth.resposta

  const { execucaoId: raw } = await params
  const execucaoId = idDe(raw)
  if (execucaoId == null) return erro("execucaoId inválido")

  const execucao = await prisma.execucaoRegistral.findUnique({
    where: { id: execucaoId },
    select: { documentoId: true, lote: { select: { processoId: true } } },
  })
  if (!execucao) return erro("Execução não encontrada", 404)

  const lote = await reprocessarDocumento({
    documentoId: execucao.documentoId,
    processoId: execucao.lote.processoId,
    usuarioId: auth.ctx.usuarioId,
  })
  const resultado = await processarLote({ loteId: lote.loteId, usuarioId: auth.ctx.usuarioId })
  return NextResponse.json({ lote, resultado })
}
