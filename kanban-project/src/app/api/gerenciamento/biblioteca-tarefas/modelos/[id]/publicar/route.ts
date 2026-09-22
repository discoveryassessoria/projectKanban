import { NextRequest, NextResponse } from "next/server"
import { verificarPermissao, extrairUsuarioComPermissoes } from "@/src/lib/verificar-permissao"
import { publicarModelo } from "@/src/services/biblioteca-tarefas/modelo"

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const erro = await verificarPermissao(request, "usuarios.gerenciar")
  if (erro) return erro

  const { id } = await params
  const usuario = await extrairUsuarioComPermissoes(request)
  const r = await publicarModelo(Number(id), usuario?.userId ?? null)
  if (!r.ok) {
    const status = r.erro === "CONFLITO_DE_VERSAO" ? 409 : r.erro === "MODELO_INEXISTENTE" ? 404 : 422
    return NextResponse.json({ error: r.mensagem, code: r.erro, problemas: r.problemas }, { status })
  }
  return NextResponse.json(r)
}
