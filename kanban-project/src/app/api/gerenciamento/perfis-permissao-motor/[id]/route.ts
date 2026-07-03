// src/app/api/gerenciamento/perfis-permissao-motor/[id]/route.ts

import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { Prisma } from "@prisma/client"
import { verificarPermissao } from "@/src/lib/verificar-permissao"

// PUT — edita (só troca o que veio no corpo)
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const erro = await verificarPermissao(request, "usuarios.gerenciar")
    if (erro) return erro

    const { id } = await params
    const perfilId = parseInt(id)
    const atual = await prisma.perfilPermissaoMotor.findUnique({ where: { id: perfilId } })
    if (!atual) return NextResponse.json({ error: "Perfil não encontrado" }, { status: 404 })

    const b = await request.json()
    const data: Prisma.PerfilPermissaoMotorUpdateInput = {
      nome: b.nome !== undefined ? b.nome : atual.nome,
      arquivado: b.arquivado !== undefined ? b.arquivado : atual.arquivado,
    }
    if (b.permissoes !== undefined) data.permissoes = b.permissoes as Prisma.InputJsonValue

    const perfil = await prisma.perfilPermissaoMotor.update({ where: { id: perfilId }, data })
    return NextResponse.json({ perfil })
  } catch (error) {
    console.error("Erro ao editar perfil de permissão:", error)
    return NextResponse.json({ error: "Erro ao editar perfil" }, { status: 500 })
  }
}

// DELETE — exclui (bloqueia se já estiver em uso)
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const erro = await verificarPermissao(request, "usuarios.gerenciar")
    if (erro) return erro

    const { id } = await params
    const perfilId = parseInt(id)
    const atual = await prisma.perfilPermissaoMotor.findUnique({ where: { id: perfilId } })
    if (!atual) return NextResponse.json({ error: "Perfil não encontrado" }, { status: 404 })

    if ((atual.usedByCount || 0) > 0) {
      return NextResponse.json({ error: "Este perfil já está em uso. Arquive em vez de excluir." }, { status: 409 })
    }

    await prisma.perfilPermissaoMotor.delete({ where: { id: perfilId } })
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error("Erro ao excluir perfil de permissão:", error)
    return NextResponse.json({ error: "Erro ao excluir perfil" }, { status: 500 })
  }
}