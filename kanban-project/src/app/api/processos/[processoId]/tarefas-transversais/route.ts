// src/app/api/processos/[processoId]/tarefas-transversais/route.ts
// GET lista as transversais do processo (opcional ?necessidadeId). POST cria uma transversal.
import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { verificarPermissao, extrairUsuarioComPermissoes } from "@/src/lib/verificar-permissao"
import { criarTarefaTransversal } from "@/src/services/tarefa-transversal"

export async function GET(request: NextRequest, { params }: { params: Promise<{ processoId: string }> }) {
  const erro = await verificarPermissao(request, "processos.ver")
  if (erro) return erro
  try {
    const { processoId } = await params
    const id = parseInt(processoId)
    if (isNaN(id)) return NextResponse.json({ error: "ID inválido" }, { status: 400 })
    const necessidadeId = new URL(request.url).searchParams.get("necessidadeId")
    const tarefas = await prisma.tarefa.findMany({
      where: { processoId: id, tipo: "TRANSVERSAL", ...(necessidadeId ? { necessidadeId: parseInt(necessidadeId) } : {}) },
      select: {
        id: true, titulo: true, statusTarefa: true, faseOrigemCode: true, faseReferenciaCode: true,
        acaoStepKey: true, necessidadeId: true, pessoaId: true, documentoId: true, tipoDocumentoId: true,
        motivo: true, resultadoEsperado: true, resultadoObtido: true, responsavelId: true, dataPrazo: true,
        dataConclusao: true, createdAt: true,
        responsavel: { select: { id: true, nome: true } },
      },
      orderBy: { createdAt: "desc" },
    })
    return NextResponse.json({ tarefas })
  } catch (e) {
    console.error("[GET tarefas-transversais]", e)
    return NextResponse.json({ error: "Erro ao listar tarefas transversais" }, { status: 500 })
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ processoId: string }> }) {
  const erro = await verificarPermissao(request, "processos.editar")
  if (erro) return erro
  try {
    const { processoId } = await params
    const id = parseInt(processoId)
    if (isNaN(id)) return NextResponse.json({ error: "ID inválido" }, { status: 400 })
    const usuario = await extrairUsuarioComPermissoes(request)
    const body = await request.json().catch(() => ({}))
    if (!body?.necessidadeOrigemId || !body?.faseReferenciaCode || !body?.acaoStepKey) {
      return NextResponse.json({ error: "necessidadeOrigemId, faseReferenciaCode e acaoStepKey são obrigatórios" }, { status: 400 })
    }
    const t = await criarTarefaTransversal({
      processoId: id,
      necessidadeOrigemId: Number(body.necessidadeOrigemId),
      faseReferenciaCode: String(body.faseReferenciaCode),
      acaoStepKey: String(body.acaoStepKey),
      pessoaId: body.pessoaId != null ? Number(body.pessoaId) : null,
      documentoId: body.documentoId != null ? Number(body.documentoId) : null,
      tipoDocumentoId: body.tipoDocumentoId != null ? Number(body.tipoDocumentoId) : null,
      motivo: body.motivo ?? null,
      resultadoEsperado: body.resultadoEsperado ?? null,
      responsavelId: body.responsavelId != null ? Number(body.responsavelId) : null,
      prazo: body.prazo ? new Date(body.prazo) : null,
      titulo: body.titulo ?? undefined,
      usuarioId: usuario?.userId ?? null,
    })
    return NextResponse.json({ tarefa: t }, { status: 201 })
  } catch (e) {
    console.error("[POST tarefas-transversais]", e)
    return NextResponse.json({ error: (e as Error)?.message ?? "Erro ao criar tarefa transversal" }, { status: 422 })
  }
}
