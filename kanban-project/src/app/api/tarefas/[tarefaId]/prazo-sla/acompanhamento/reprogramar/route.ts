// ESTE ARQUIVO VAI EM: src/app/api/tarefas/[tarefaId]/prazo-sla/acompanhamento/reprogramar/route.ts
//
// POST - reprograma o próximo acompanhamento (Daniela pode: permissão
//        operacional `tarefas.editar`, NÃO `usuarios.gerenciar`).

import { NextRequest, NextResponse } from "next/server"
import { verificarPermissao, extrairUsuarioComPermissoes } from "@/src/lib/verificar-permissao"
import { reprogramarAcompanhamento } from "@/src/services/prazo-sla/tarefa-prazo-sla"

export async function POST(request: NextRequest, { params }: { params: Promise<{ tarefaId: string }> }) {
  const erro = await verificarPermissao(request, "tarefas.editar")
  if (erro) return erro
  try {
    const { tarefaId } = await params
    const b = await request.json().catch(() => ({}))
    if (!b?.novaData) return NextResponse.json({ error: "Informe a nova data.", code: "DATA_OBRIGATORIA" }, { status: 400 })
    const usuario = await extrairUsuarioComPermissoes(request)
    const resultado = await reprogramarAcompanhamento({
      tarefaId: Number(tarefaId), novaData: new Date(b.novaData), motivo: String(b?.motivo || ""),
      usuarioId: usuario?.userId ?? null, agora: b?.agora ? new Date(b.agora) : new Date(),
    })
    if (!resultado.success) return NextResponse.json({ error: resultado.message, code: resultado.code }, { status: 400 })
    return NextResponse.json(resultado)
  } catch (error) {
    console.error("Erro ao reprogramar acompanhamento:", error)
    return NextResponse.json({ error: "Erro interno" }, { status: 500 })
  }
}
