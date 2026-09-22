// ESTE ARQUIVO VAI EM: src/app/api/tarefas/[tarefaId]/prazo-sla/espera-terceiro/encerrar/route.ts
//
// POST - encerra a espera (mesma permissão de retomar_espera).

import { NextRequest, NextResponse } from "next/server"
import { verificarPermissao, extrairUsuarioComPermissoes } from "@/src/lib/verificar-permissao"
import { encerrarEsperaTerceiro } from "@/src/services/prazo-sla/tarefa-prazo-sla"

export async function POST(request: NextRequest, { params }: { params: Promise<{ tarefaId: string }> }) {
  const erro = await verificarPermissao(request, "tarefas.iniciar_concluir")
  if (erro) return erro
  try {
    const { tarefaId } = await params
    const b = await request.json().catch(() => ({}))
    const usuario = await extrairUsuarioComPermissoes(request)
    const resultado = await encerrarEsperaTerceiro({
      tarefaId: Number(tarefaId), agora: b?.agora ? new Date(b.agora) : new Date(), usuarioId: usuario?.userId ?? null,
    })
    if (!resultado.success) return NextResponse.json({ error: resultado.message, code: resultado.code }, { status: 400 })
    return NextResponse.json(resultado)
  } catch (error) {
    console.error("Erro ao encerrar espera de terceiro:", error)
    return NextResponse.json({ error: "Erro interno" }, { status: 500 })
  }
}
