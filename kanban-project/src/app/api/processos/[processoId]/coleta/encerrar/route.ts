// POST /api/processos/[processoId]/coleta/encerrar — o administrador encerra o link antes da hora.
// Os envios já feitos continuam pendentes (a conferência acontece ao mover o processo).
import { NextRequest, NextResponse } from "next/server"
import { extrairUsuarioComPermissoes, verificarPermissao } from "@/src/lib/verificar-permissao"
import { encerrarLinkDeColeta } from "@/src/services/coleta/coleta-link"

export const dynamic = "force-dynamic"

export async function POST(req: NextRequest, { params }: { params: Promise<{ processoId: string }> }) {
  const erro = await verificarPermissao(req, "clientes.criar")
  if (erro) return erro
  const processoId = Number((await params).processoId)
  if (!Number.isInteger(processoId) || processoId <= 0) return NextResponse.json({ error: "ID inválido" }, { status: 400 })
  const usuario = await extrairUsuarioComPermissoes(req)
  const r = await encerrarLinkDeColeta(processoId, usuario?.userId ?? null, "MANUAL")
  return NextResponse.json(r)
}
