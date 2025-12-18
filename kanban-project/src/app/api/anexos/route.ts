import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

// POST - Salvar anexo
export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { nome, nomeArquivo, urlArquivo, tamanho, mimeType, tipoCliente, contratanteId, requerenteId } = body

    if (!urlArquivo || !nomeArquivo) {
      return NextResponse.json({ error: "Dados do arquivo são obrigatórios" }, { status: 400 })
    }

    let anexo

    if (tipoCliente === "requerente" && requerenteId) {
      anexo = await prisma.anexoRequerente.create({
        data: {
          nome: nome || nomeArquivo,
          nomeArquivo,
          urlArquivo,
          tamanho: tamanho || null,
          mimeType: mimeType || null,
          tipo: "Documento",
          requerenteId: parseInt(requerenteId),
        },
      })
    } else if (contratanteId) {
      anexo = await prisma.anexoContratante.create({
        data: {
          nome: nome || nomeArquivo,
          nomeArquivo,
          urlArquivo,
          tamanho: tamanho || null,
          mimeType: mimeType || null,
          tipo: "Documento",
          contratanteId: parseInt(contratanteId),
        },
      })
    } else {
      return NextResponse.json({ error: "ID do cliente é obrigatório" }, { status: 400 })
    }

    return NextResponse.json({ anexo }, { status: 201 })
  } catch (error) {
    console.error("Erro ao salvar anexo:", error)
    return NextResponse.json({ error: "Erro ao salvar anexo" }, { status: 500 })
  }
}

// GET - Buscar anexos por cliente
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const tipoCliente = searchParams.get("tipoCliente")
    const id = searchParams.get("id")

    if (!id) {
      return NextResponse.json({ error: "ID é obrigatório" }, { status: 400 })
    }

    let anexos

    if (tipoCliente === "requerente") {
      anexos = await prisma.anexoRequerente.findMany({
        where: { requerenteId: parseInt(id) },
        orderBy: { createdAt: "desc" },
      })
    } else {
      anexos = await prisma.anexoContratante.findMany({
        where: { contratanteId: parseInt(id) },
        orderBy: { createdAt: "desc" },
      })
    }

    return NextResponse.json({ anexos })
  } catch (error) {
    console.error("Erro ao buscar anexos:", error)
    return NextResponse.json({ error: "Erro ao buscar anexos" }, { status: 500 })
  }
}

// DELETE - Excluir anexo
export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const tipoCliente = searchParams.get("tipoCliente")
    const id = searchParams.get("id")

    if (!id) {
      return NextResponse.json({ error: "ID é obrigatório" }, { status: 400 })
    }

    if (tipoCliente === "requerente") {
      await prisma.anexoRequerente.delete({
        where: { id: parseInt(id) },
      })
    } else {
      await prisma.anexoContratante.delete({
        where: { id: parseInt(id) },
      })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Erro ao excluir anexo:", error)
    return NextResponse.json({ error: "Erro ao excluir anexo" }, { status: 500 })
  }
}