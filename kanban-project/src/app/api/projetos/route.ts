import type { NextRequest } from "next/server"
import { prisma } from "@/lib/prisma"

export async function GET(request: NextRequest) {
  try {
    const projetos = await prisma.projetoKanban.findMany({
      include: {
        atividades: {
          include: {
            status: true,
            usuarios: {
              include: {
                usuario: true,
              },
            },
          },
        },
        status: true,
      },
    })

    return Response.json({ projetos })
  } catch (error) {
    console.error("Erro ao buscar projetos:", error)
    return Response.json({ error: "Erro interno do servidor" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    console.log("🔍 Iniciando criação de projeto...")

    const { nome, descricao, usuarioId } = await request.json()
    console.log("📝 Dados recebidos:", { nome, descricao, usuarioId })

    if (!nome) {
      console.log("❌ Nome obrigatório faltando")
      return Response.json({ error: "Nome do projeto é obrigatório" }, { status: 400 })
    }

    console.log("🏗️ Criando projeto...")

    const projeto = await prisma.projetoKanban.create({
      data: {
        nome,
        descricao,
      },
    })

    console.log("✅ Projeto criado:", projeto.id)
    console.log("🎯 Criando status padrão...")

    // Criar os status padrão para o projeto
    const statusPadrao = [
      { nome: "A Fazer", projetoId: projeto.id },
      { nome: "Em Andamento", projetoId: projeto.id },
      { nome: "Concluído", projetoId: projeto.id },
    ]

    for (const status of statusPadrao) {
      await prisma.status.create({
        data: {
          nome: status.nome,
          projeto: {
            connect: { id: projeto.id },
          },
        },
      })
    }

    console.log("✅ Status padrão criados")
    console.log("📦 Buscando projeto completo...")

    const projetoCompleto = await prisma.projetoKanban.findUnique({
      where: { id: projeto.id },
      include: {
        atividades: {
          include: {
            status: true,
            usuarios: {
              include: {
                usuario: true,
              },
            },
          },
        },
        status: true,
      },
    })

    console.log("✅ Projeto criado com sucesso no BD!")
    return Response.json({ projeto: projetoCompleto }, { status: 201 })
  } catch (error) {
    console.error("💥 Erro ao criar projeto:", error)
    console.error("Stack trace:", error instanceof Error ? error.stack : "N/A")
    return Response.json(
      { error: "Erro interno do servidor: " + (error instanceof Error ? error.message : "Erro desconhecido") },
      { status: 500 },
    )
  }
}
