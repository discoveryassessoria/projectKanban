// src/app/api/tarefas-transversais/[id]/operacao/route.ts
// GET: passos da operação transversal (Solicitar→…→Validar). PATCH: conclui o passo ativo.
import { NextRequest, NextResponse } from "next/server"
import { verificarPermissao, extrairUsuarioComPermissoes } from "@/src/lib/verificar-permissao"
import { getOperacaoTransversal, avancarPassoTransversal } from "@/src/services/tarefa-transversal"

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const erro = await verificarPermissao(request, "processos.ver")
  if (erro) return erro
  try {
    const { id } = await params
    const tarefaId = parseInt(id)
    if (isNaN(tarefaId)) return NextResponse.json({ error: "ID inválido" }, { status: 400 })
    return NextResponse.json(await getOperacaoTransversal(tarefaId))
  } catch (e) {
    console.error("[GET transversal/operacao]", e)
    return NextResponse.json({ error: "Erro ao carregar operação" }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const erro = await verificarPermissao(request, "tarefas.iniciar_concluir")
  if (erro) return erro
  try {
    const { id } = await params
    const tarefaId = parseInt(id)
    if (isNaN(tarefaId)) return NextResponse.json({ error: "ID inválido" }, { status: 400 })
    const usuario = await extrairUsuarioComPermissoes(request)
    const body = await request.json().catch(() => ({}))
    if (!body?.stepInstanceId) return NextResponse.json({ error: "stepInstanceId obrigatório" }, { status: 400 })
    const r = await avancarPassoTransversal(tarefaId, Number(body.stepInstanceId), { usuarioId: usuario?.userId ?? null })
    return NextResponse.json(r)
  } catch (e) {
    console.error("[PATCH transversal/operacao]", e)
    return NextResponse.json({ error: (e as Error)?.message ?? "Erro" }, { status: 422 })
  }
}
