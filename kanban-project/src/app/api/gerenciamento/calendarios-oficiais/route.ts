// ESTE ARQUIVO VAI EM: src/app/api/gerenciamento/calendarios-oficiais/route.ts
//
// GET  - lista os calendários (com contagem de feriados)
// POST - cria calendário novo

import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { verificarPermissao } from "@/src/lib/verificar-permissao"

function slug(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "")
}

export async function GET(request: NextRequest) {
  const erro = await verificarPermissao(request, "usuarios.gerenciar")
  if (erro) return erro
  try {
    const calendarios = await prisma.calendarioOficial.findMany({
      orderBy: { nome: "asc" },
      include: { _count: { select: { feriados: true } } },
    })
    return NextResponse.json({ calendarios })
  } catch (error) {
    console.error("Erro ao listar calendários:", error)
    return NextResponse.json({ error: "Erro interno" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const erro = await verificarPermissao(request, "usuarios.gerenciar")
  if (erro) return erro
  try {
    const b = await request.json().catch(() => ({}))
    const nome = String(b?.nome || "").trim()
    if (!nome) return NextResponse.json({ error: "Informe o nome do calendário." }, { status: 400 })
    const chave = String(b?.chave || "").trim() || slug(nome)
    if (!chave) return NextResponse.json({ error: "Não foi possível gerar a chave do calendário." }, { status: 400 })

    const calendario = await prisma.calendarioOficial.create({ data: { chave, nome, descricao: b?.descricao ? String(b.descricao) : null } })
    return NextResponse.json({ calendario }, { status: 201 })
  } catch (error: any) {
    if (error?.code === "P2002") return NextResponse.json({ error: "Já existe um calendário com essa chave." }, { status: 409 })
    console.error("Erro ao criar calendário:", error)
    return NextResponse.json({ error: "Erro interno" }, { status: 500 })
  }
}
