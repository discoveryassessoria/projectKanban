import { type NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { Prisma, TipoDocumento, StatusDocumento } from "@prisma/client"

// GET - Buscar documento por ID
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: idParam } = await params
    const id = Number.parseInt(idParam)

    if (isNaN(id)) {
      return NextResponse.json({ error: "ID inválido" }, { status: 400 })
    }

    const documento = await prisma.documento.findUnique({
      where: { id },
      include: {
        pessoa: {
          include: {
            arvore: true,
            pai: {
              select: { id: true, nome: true, sobrenome: true }
            },
            mae: {
              select: { id: true, nome: true, sobrenome: true }
            },
          }
        }
      },
    })

    if (!documento) {
      return NextResponse.json({ error: "Documento não encontrado" }, { status: 404 })
    }

    return NextResponse.json(documento)
  } catch (error) {
    console.error("Erro ao buscar documento:", error)
    return NextResponse.json({ error: "Erro interno do servidor" }, { status: 500 })
  }
}

// PUT - Atualizar documento
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: idParam } = await params
    const id = Number.parseInt(idParam)

    if (isNaN(id)) {
      return NextResponse.json({ error: "ID inválido" }, { status: 400 })
    }

    const body = await request.json()

    const dataToUpdate: Prisma.DocumentoUpdateInput = {}

    // Tipo e status
    if (body.tipo !== undefined) {
      if (!Object.values(TipoDocumento).includes(body.tipo)) {
        return NextResponse.json({ error: "Tipo de documento inválido" }, { status: 400 })
      }
      dataToUpdate.tipo = body.tipo
    }
    if (body.status !== undefined) {
      if (!Object.values(StatusDocumento).includes(body.status)) {
        return NextResponse.json({ error: "Status inválido" }, { status: 400 })
      }
      dataToUpdate.status = body.status
    }
    if (body.descricao !== undefined) dataToUpdate.descricao = body.descricao

    // Dados do registro
    if (body.cartorio !== undefined) dataToUpdate.cartorio = body.cartorio
    if (body.livro !== undefined) dataToUpdate.livro = body.livro
    if (body.folha !== undefined) dataToUpdate.folha = body.folha
    if (body.termo !== undefined) dataToUpdate.termo = body.termo
    if (body.numero_registro !== undefined) dataToUpdate.numero_registro = body.numero_registro
    if (body.data_registro !== undefined) dataToUpdate.data_registro = body.data_registro ? new Date(body.data_registro) : null
    if (body.cidade_registro !== undefined) dataToUpdate.cidade_registro = body.cidade_registro
    if (body.estado_registro !== undefined) dataToUpdate.estado_registro = body.estado_registro
    if (body.pais_registro !== undefined) dataToUpdate.pais_registro = body.pais_registro

    // Documentos de identidade
    if (body.numero !== undefined) dataToUpdate.numero = body.numero
    if (body.orgao_emissor !== undefined) dataToUpdate.orgao_emissor = body.orgao_emissor
    if (body.data_emissao !== undefined) dataToUpdate.data_emissao = body.data_emissao ? new Date(body.data_emissao) : null
    if (body.data_validade !== undefined) dataToUpdate.data_validade = body.data_validade ? new Date(body.data_validade) : null

    // Arquivo
    if (body.arquivo_url !== undefined) dataToUpdate.arquivo_url = body.arquivo_url
    if (body.arquivo_nome !== undefined) dataToUpdate.arquivo_nome = body.arquivo_nome
    if (body.arquivo_tamanho !== undefined) dataToUpdate.arquivo_tamanho = body.arquivo_tamanho
    if (body.arquivo_mime_type !== undefined) dataToUpdate.arquivo_mime_type = body.arquivo_mime_type

    // Tradução
    if (body.traduzido !== undefined) dataToUpdate.traduzido = body.traduzido
    if (body.tradutor !== undefined) dataToUpdate.tradutor = body.tradutor
    if (body.data_traducao !== undefined) dataToUpdate.data_traducao = body.data_traducao ? new Date(body.data_traducao) : null
    if (body.arquivo_traducao_url !== undefined) dataToUpdate.arquivo_traducao_url = body.arquivo_traducao_url
    if (body.arquivo_traducao_nome !== undefined) dataToUpdate.arquivo_traducao_nome = body.arquivo_traducao_nome

    // Apostilamento
    if (body.apostilado !== undefined) dataToUpdate.apostilado = body.apostilado
    if (body.numero_apostila !== undefined) dataToUpdate.numero_apostila = body.numero_apostila
    if (body.data_apostila !== undefined) dataToUpdate.data_apostila = body.data_apostila ? new Date(body.data_apostila) : null
    if (body.arquivo_apostila_url !== undefined) dataToUpdate.arquivo_apostila_url = body.arquivo_apostila_url

    // Observações
    if (body.observacoes !== undefined) dataToUpdate.observacoes = body.observacoes

    const documentoAtualizado = await prisma.documento.update({
      where: { id },
      data: dataToUpdate,
      include: {
        pessoa: {
          select: {
            id: true,
            nome: true,
            sobrenome: true,
          }
        }
      }
    })

    return NextResponse.json(documentoAtualizado)
  } catch (error) {
    console.error("Erro ao atualizar documento:", error)

    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === "P2025") {
        return NextResponse.json({ error: "Documento não encontrado" }, { status: 404 })
      }
    }

    return NextResponse.json({ error: "Erro interno do servidor" }, { status: 500 })
  }
}

// DELETE - Excluir documento
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: idParam } = await params
    const id = Number.parseInt(idParam)

    if (isNaN(id)) {
      return NextResponse.json({ error: "ID inválido" }, { status: 400 })
    }

    // Verificar se o documento existe
    const documento = await prisma.documento.findUnique({
      where: { id }
    })

    if (!documento) {
      return NextResponse.json({ error: "Documento não encontrado" }, { status: 404 })
    }

    await prisma.documento.delete({
      where: { id }
    })

    return NextResponse.json({ message: "Documento excluído com sucesso", id })
  } catch (error) {
    console.error("Erro ao excluir documento:", error)

    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === "P2025") {
        return NextResponse.json({ error: "Documento não encontrado" }, { status: 404 })
      }
    }

    return NextResponse.json({ error: "Erro interno do servidor" }, { status: 500 })
  }
}

// PATCH - Atualizar status do documento (atalho)
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: idParam } = await params
    const id = Number.parseInt(idParam)

    if (isNaN(id)) {
      return NextResponse.json({ error: "ID inválido" }, { status: 400 })
    }

    const body = await request.json()

    // Validar status
    if (!body.status || !Object.values(StatusDocumento).includes(body.status)) {
      return NextResponse.json(
        { error: "Status inválido", statusValidos: Object.values(StatusDocumento) },
        { status: 400 }
      )
    }

    const documentoAtualizado = await prisma.documento.update({
      where: { id },
      data: { status: body.status },
      include: {
        pessoa: {
          select: {
            id: true,
            nome: true,
            sobrenome: true,
          }
        }
      }
    })

    return NextResponse.json(documentoAtualizado)
  } catch (error) {
    console.error("Erro ao atualizar status:", error)

    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === "P2025") {
        return NextResponse.json({ error: "Documento não encontrado" }, { status: 404 })
      }
    }

    return NextResponse.json({ error: "Erro interno do servidor" }, { status: 500 })
  }
}