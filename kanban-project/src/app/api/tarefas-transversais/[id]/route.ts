// src/app/api/tarefas-transversais/[id]/route.ts
// PATCH: concluir (com resultado + se resolveu a necessidade) ou cancelar uma transversal.
import { NextRequest, NextResponse } from "next/server"
import { verificarPermissao, extrairUsuarioComPermissoes } from "@/src/lib/verificar-permissao"
import { concluirTarefaTransversal, cancelarTarefaTransversal } from "@/src/services/tarefa-transversal"

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const erro = await verificarPermissao(request, "tarefas.iniciar_concluir")
  if (erro) return erro
  try {
    const { id } = await params
    const tarefaId = parseInt(id)
    if (isNaN(tarefaId)) return NextResponse.json({ error: "ID inválido" }, { status: 400 })
    const usuario = await extrairUsuarioComPermissoes(request)
    const body = await request.json().catch(() => ({}))
    const acao = body?.acao as string

    if (acao === "concluir") {
      const t = await concluirTarefaTransversal(tarefaId, {
        resultadoObtido: body.resultadoObtido ?? null,
        resolveuNecessidade: body.resolveuNecessidade === true,
        usuarioId: usuario?.userId ?? null,
      })
      return NextResponse.json({ tarefa: t })
    }
    if (acao === "cancelar") {
      const t = await cancelarTarefaTransversal(tarefaId, { motivo: body.motivo ?? null, usuarioId: usuario?.userId ?? null })
      return NextResponse.json({ tarefa: t })
    }
    return NextResponse.json({ error: "Ação inválida (concluir|cancelar)" }, { status: 400 })
  } catch (e) {
    console.error("[PATCH tarefas-transversais/[id]]", e)
    return NextResponse.json({ error: (e as Error)?.message ?? "Erro" }, { status: 422 })
  }
}
