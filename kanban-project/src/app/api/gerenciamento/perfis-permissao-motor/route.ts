// src/app/api/gerenciamento/perfis-permissao-motor/route.ts

import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { Prisma } from "@prisma/client"
import { verificarPermissao } from "@/src/lib/verificar-permissao"

// GET — lista os perfis de permissão
export async function GET() {
  try {
    const perfis = await prisma.perfilPermissaoMotor.findMany({
      orderBy: [{ arquivado: "asc" }, { nome: "asc" }],
    })
    return NextResponse.json({ perfis })
  } catch (error) {
    console.error("Erro ao listar perfis de permissão:", error)
    return NextResponse.json({ error: "Erro ao listar perfis" }, { status: 500 })
  }
}

// POST — cria um perfil
export async function POST(request: Request) {
  try {
    const erro = await verificarPermissao(request, "usuarios.gerenciar")
    if (erro) return erro

    const b = await request.json()
    if (!b?.nome) return NextResponse.json({ error: "Nome é obrigatório" }, { status: 400 })

    const perfil = await prisma.perfilPermissaoMotor.create({
      data: {
        chave: b.chave || "perm_custom_" + Math.random().toString(36).slice(2, 9),
        nome: b.nome,
        permissoes: (b.permissoes ?? undefined) as Prisma.InputJsonValue,
        isSystemTemplate: b.isSystemTemplate ?? false,
        arquivado: b.arquivado ?? false,
      },
    })
    return NextResponse.json({ perfil }, { status: 201 })
  } catch (error) {
    console.error("Erro ao criar perfil de permissão:", error)
    return NextResponse.json({ error: "Erro ao criar perfil" }, { status: 500 })
  }
}