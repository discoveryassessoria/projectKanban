// POST/GET — LOTE REGISTRAL da Pasta Documental de um processo.
//
// POST processa a pasta (1, 20, 100+ certidões) como conjunto coerente. É
// idempotente: reenviar o mesmo pedido devolve o mesmo lote em vez de disparar
// um segundo processamento.
import { type NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { criarLote, processarLote } from "@/src/services/registral/lote"
import { erro, exigir, exigirAlguma, idDe } from "@/src/services/registral/autorizacao"

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ processoId: string }> },
) {
  const auth = await exigir(request, "registral.reprocessar")
  if (!auth.ok) return auth.resposta

  const { processoId: raw } = await params
  const processoId = idDe(raw)
  if (processoId == null) return erro("processoId inválido")

  const body = await request.json().catch(() => ({}))
  const documentoIds = Array.isArray(body?.documentoIds)
    ? (body.documentoIds as unknown[]).map(Number).filter((n) => Number.isFinite(n) && n > 0)
    : undefined
  // `processarAgora=false` só cria o lote (o worker/cron drena depois).
  const processarAgora = body?.processarAgora !== false
  const limite = Number.isFinite(Number(body?.limite)) ? Number(body.limite) : undefined

  try {
    const lote = await criarLote({
      processoId,
      documentoIds,
      usuarioId: auth.ctx.usuarioId,
    })
    if (!processarAgora) return NextResponse.json({ lote }, { status: lote.criado ? 201 : 200 })

    const resultado = await processarLote({
      loteId: lote.loteId,
      limite,
      usuarioId: auth.ctx.usuarioId,
    })
    return NextResponse.json({ lote, resultado }, { status: lote.criado ? 201 : 200 })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error("[registral][lotes][POST]", msg)
    return erro(msg, 422)
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ processoId: string }> },
) {
  const auth = await exigirAlguma(request, ["registral.ver_evidencias", "registral.revisar", "arvore.ver"])
  if (!auth.ok) return auth.resposta

  const { processoId: raw } = await params
  const processoId = idDe(raw)
  if (processoId == null) return erro("processoId inválido")

  const lotes = await prisma.loteRegistral.findMany({
    where: { processoId },
    orderBy: { criadoEm: "desc" },
    take: 50,
    select: {
      id: true,
      status: true,
      versaoMotor: true,
      totalDocumentos: true,
      processados: true,
      falhos: true,
      aguardando: true,
      propostasCriadas: true,
      conflitosAbertos: true,
      evidenciasCriadas: true,
      resumo: true,
      criadoEm: true,
      finalizadoEm: true,
      correlationId: true,
      criadoPor: { select: { id: true, nome: true } },
    },
  })
  return NextResponse.json({ lotes })
}
