// src/app/api/familias/route.ts
// CP-1 — CRUD de Família (entidade administrativa). Backend-first.
import { type NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { verificarPermissao } from "@/src/lib/verificar-permissao"

// GET - Listar famílias (com contagem de processos/árvores)
export async function GET(request: NextRequest) {
  const erro = await verificarPermissao(request, "processos.ver")
  if (erro) return erro
  try {
    const familias = await prisma.familia.findMany({
      include: {
        _count: { select: { processos: true, arvores: true } },
      },
      orderBy: { id: "desc" },
    })
    return NextResponse.json({ familias })
  } catch (error) {
    console.error("Erro ao listar famílias:", error)
    return NextResponse.json({ error: "Erro interno do servidor" }, { status: 500 })
  }
}

// POST - Criar família
export async function POST(request: NextRequest) {
  const erro = await verificarPermissao(request, "processos.criar")
  if (erro) return erro
  try {
    const { nome, descricao, observacoes } = await request.json()
    if (!nome || !String(nome).trim()) {
      return NextResponse.json({ error: "O nome da família é obrigatório" }, { status: 400 })
    }
    const familia = await prisma.familia.create({
      data: {
        nome: String(nome).trim(),
        descricao: descricao ?? null,
        observacoes: observacoes ?? null,
      },
    })
    return NextResponse.json(familia, { status: 201 })
  } catch (error) {
    console.error("Erro ao criar família:", error)
    return NextResponse.json({ error: "Erro interno do servidor" }, { status: 500 })
  }
}
