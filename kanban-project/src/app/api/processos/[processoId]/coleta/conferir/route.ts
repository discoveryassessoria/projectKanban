// POST /api/processos/[processoId]/coleta/conferir — a CONFERÊNCIA. Corpo:
//   { decisoes: [{ envioId, acao: "CONFIRMAR" | "DESCARTAR", papel? }] }  — TODOS os pendentes decididos
//   { descartarTodos: true }                                              — "Seguir sem cadastrar ninguém"
// Não move o processo de fase: quem chama repete a ação de mover depois (a porta de fase deixa passar
// quando não restam pendentes). Não toca a árvore.
import { NextRequest, NextResponse } from "next/server"
import { extrairUsuarioComPermissoes, verificarPermissao } from "@/src/lib/verificar-permissao"
import { conferirColeta, descartarTodosOsPendentes, type DecisaoConferencia } from "@/src/services/coleta/coleta-conferencia"

export const dynamic = "force-dynamic"

export async function POST(req: NextRequest, { params }: { params: Promise<{ processoId: string }> }) {
  const erro = await verificarPermissao(req, "clientes.criar")
  if (erro) return erro
  const processoId = Number((await params).processoId)
  if (!Number.isInteger(processoId) || processoId <= 0) return NextResponse.json({ error: "ID inválido" }, { status: 400 })
  let corpo: { decisoes?: DecisaoConferencia[]; descartarTodos?: boolean }
  try { corpo = await req.json() } catch { return NextResponse.json({ error: "Pedido inválido." }, { status: 400 }) }

  const usuario = await extrairUsuarioComPermissoes(req)
  const autorId = usuario?.userId ?? null
  const r = corpo.descartarTodos === true
    ? await descartarTodosOsPendentes(processoId, autorId)
    : await conferirColeta(processoId, Array.isArray(corpo.decisoes) ? corpo.decisoes : [], autorId)
  if (!r.ok) return NextResponse.json({ error: r.message, code: r.code }, { status: r.code === "CONFLITO" ? 409 : 400 })
  return NextResponse.json(r)
}
