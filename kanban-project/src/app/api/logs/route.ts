// src/app/api/logs/route.ts

import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

// GET - Buscar logs de auditoria
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const limite = parseInt(searchParams.get("limite") || "10")
    const entidade = searchParams.get("entidade")
    const acao = searchParams.get("acao")

    const where: any = {}
    if (entidade) where.entidade = entidade
    if (acao) where.acao = acao

    const logs = await prisma.logAuditoria.findMany({
      where,
      include: {
        usuario: {
          select: {
            id: true,
            nome: true
          }
        }
      },
      orderBy: { criadoEm: "desc" },
      take: limite
    })

    return NextResponse.json(logs)
  } catch (error) {
    console.error("Erro ao buscar logs:", error)
    return NextResponse.json([], { status: 500 })
  }
}