// ESTE ARQUIVO VAI EM: src/app/api/gerenciamento/calendarios-oficiais/[id]/feriados/route.ts
//
// GET  - lista os feriados do calendário
// POST - adiciona um feriado (data + nome + recorrente anual ou não)

import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { verificarPermissao } from "@/src/lib/verificar-permissao"

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const erro = await verificarPermissao(request, "usuarios.gerenciar")
  if (erro) return erro
  try {
    const { id } = await params
    const feriados = await prisma.feriadoCalendario.findMany({ where: { calendarioId: Number(id) }, orderBy: { data: "asc" } })
    return NextResponse.json({ feriados })
  } catch (error) {
    console.error("Erro ao listar feriados:", error)
    return NextResponse.json({ error: "Erro interno" }, { status: 500 })
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const erro = await verificarPermissao(request, "usuarios.gerenciar")
  if (erro) return erro
  try {
    const { id } = await params
    const calendario = await prisma.calendarioOficial.findUnique({ where: { id: Number(id) } })
    if (!calendario) return NextResponse.json({ error: "Calendário não encontrado." }, { status: 404 })

    const b = await request.json().catch(() => ({}))
    const nome = String(b?.nome || "").trim()
    if (!nome) return NextResponse.json({ error: "Informe o nome do feriado." }, { status: 400 })
    if (!b?.data) return NextResponse.json({ error: "Informe a data do feriado." }, { status: 400 })
    const data = new Date(b.data)
    if (Number.isNaN(data.getTime())) return NextResponse.json({ error: "Data inválida." }, { status: 400 })

    const feriado = await prisma.feriadoCalendario.create({
      data: { calendarioId: calendario.id, data, nome, recorrenteAnual: Boolean(b?.recorrenteAnual) },
    })
    return NextResponse.json({ feriado }, { status: 201 })
  } catch (error: any) {
    if (error?.code === "P2002") return NextResponse.json({ error: "Este calendário já tem um feriado nessa data." }, { status: 409 })
    console.error("Erro ao criar feriado:", error)
    return NextResponse.json({ error: "Erro interno" }, { status: 500 })
  }
}
