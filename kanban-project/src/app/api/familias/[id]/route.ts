// src/app/api/familias/[id]/route.ts
// CP-1 — detalhe/edição/remoção de Família. Backend-first.
import { type NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { verificarPermissao } from "@/src/lib/verificar-permissao"

// GET - Detalhe da família (com processos e árvores vinculados)
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const erro = await verificarPermissao(request, "processos.ver")
  if (erro) return erro
  try {
    const { id: idParam } = await params
    const id = parseInt(idParam)
    if (isNaN(id)) return NextResponse.json({ error: "ID inválido" }, { status: 400 })

    const familia = await prisma.familia.findUnique({
      where: { id },
      include: {
        processos: { select: { id: true, nome: true, pais: true } },
        arvores: { select: { id: true, nome: true } },
      },
    })
    if (!familia) return NextResponse.json({ error: "Família não encontrada" }, { status: 404 })
    return NextResponse.json(familia)
  } catch (error) {
    console.error("Erro ao buscar família:", error)
    return NextResponse.json({ error: "Erro interno do servidor" }, { status: 500 })
  }
}

// PUT - Editar família
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const erro = await verificarPermissao(request, "processos.editar")
  if (erro) return erro
  try {
    const { id: idParam } = await params
    const id = parseInt(idParam)
    if (isNaN(id)) return NextResponse.json({ error: "ID inválido" }, { status: 400 })

    const { nome, descricao, observacoes } = await request.json()
    const familia = await prisma.familia.update({
      where: { id },
      data: {
        ...(nome !== undefined ? { nome: String(nome).trim() } : {}),
        ...(descricao !== undefined ? { descricao } : {}),
        ...(observacoes !== undefined ? { observacoes } : {}),
      },
    })
    return NextResponse.json(familia)
  } catch (error) {
    console.error("Erro ao editar família:", error)
    return NextResponse.json({ error: "Erro interno do servidor" }, { status: 500 })
  }
}

// DELETE - Remover família (CP-1: só se não houver processos/árvores vinculados).
// Não removemos legado nem cascateamos — apenas soltamos famílias vazias.
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const erro = await verificarPermissao(request, "processos.excluir")
  if (erro) return erro
  try {
    const { id: idParam } = await params
    const id = parseInt(idParam)
    if (isNaN(id)) return NextResponse.json({ error: "ID inválido" }, { status: 400 })

    const vinculos = await prisma.familia.findUnique({
      where: { id },
      select: { _count: { select: { processos: true, arvores: true } } },
    })
    if (!vinculos) return NextResponse.json({ error: "Família não encontrada" }, { status: 404 })
    if (vinculos._count.processos > 0 || vinculos._count.arvores > 0) {
      return NextResponse.json(
        { error: "Família possui processos ou árvores vinculados; desvincule antes de excluir." },
        { status: 409 }
      )
    }

    await prisma.familia.delete({ where: { id } })
    return NextResponse.json({ message: "Família removida" })
  } catch (error) {
    console.error("Erro ao remover família:", error)
    return NextResponse.json({ error: "Erro interno do servidor" }, { status: 500 })
  }
}
