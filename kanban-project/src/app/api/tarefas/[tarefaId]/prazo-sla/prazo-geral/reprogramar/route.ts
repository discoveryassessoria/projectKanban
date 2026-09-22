// ESTE ARQUIVO VAI EM: src/app/api/tarefas/[tarefaId]/prazo-sla/prazo-geral/reprogramar/route.ts
//
// POST - reprograma o PRAZO GERAL da tarefa — RESTRITO a permissão
//        administrativa (`usuarios.gerenciar`, nunca `tarefas.editar`).
//        Daniela NÃO pode chamar esta rota (mandato, seção 8).

import { NextRequest, NextResponse } from "next/server"
import { verificarPermissao, extrairUsuarioComPermissoes } from "@/src/lib/verificar-permissao"
import { reprogramarPrazoGeral } from "@/src/services/prazo-sla/tarefa-prazo-sla"

export async function POST(request: NextRequest, { params }: { params: Promise<{ tarefaId: string }> }) {
  const erro = await verificarPermissao(request, "usuarios.gerenciar")
  if (erro) return erro
  try {
    const { tarefaId } = await params
    const b = await request.json().catch(() => ({}))
    if (!b?.novoPrazo) return NextResponse.json({ error: "Informe o novo prazo.", code: "PRAZO_OBRIGATORIO" }, { status: 400 })
    const usuario = await extrairUsuarioComPermissoes(request)
    const resultado = await reprogramarPrazoGeral({
      tarefaId: Number(tarefaId), novoPrazo: new Date(b.novoPrazo), justificativa: String(b?.justificativa || ""),
      usuarioId: usuario?.userId ?? null, agora: b?.agora ? new Date(b.agora) : new Date(),
    })
    if (!resultado.success) return NextResponse.json({ error: resultado.message, code: resultado.code }, { status: 400 })
    return NextResponse.json(resultado)
  } catch (error) {
    console.error("Erro ao reprogramar prazo geral:", error)
    return NextResponse.json({ error: "Erro interno" }, { status: 500 })
  }
}
