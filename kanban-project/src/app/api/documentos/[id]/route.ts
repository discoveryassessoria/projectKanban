// src/app/api/documentos/[id]/route.ts
// ✅ ATUALIZADO: Adiciona automação de criar tarefa quando status muda para SOLICITAR

import { type NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { Prisma, TipoDocumento, StatusDocumento } from "@prisma/client"

// Helper para obter label do tipo de documento
function getTipoDocumentoLabel(tipo: string): string {
  const labels: Record<string, string> = {
    CERTIDAO_NASCIMENTO: "Certidão de Nascimento",
    CERTIDAO_NASCIMENTO_INTEIRO_TEOR: "Certidão de Nascimento (Inteiro Teor)",
    CERTIDAO_CASAMENTO: "Certidão de Casamento",
    CERTIDAO_CASAMENTO_INTEIRO_TEOR: "Certidão de Casamento (Inteiro Teor)",
    CERTIDAO_OBITO: "Certidão de Óbito",
    CERTIDAO_OBITO_INTEIRO_TEOR: "Certidão de Óbito (Inteiro Teor)",
    CERTIDAO_BATISMO: "Certidão de Batismo",
    CNN: "Certidão Negativa de Naturalização",
    RG: "RG",
    CPF: "CPF",
    CNH: "CNH",
    PASSAPORTE_BRASILEIRO: "Passaporte Brasileiro",
    PASSAPORTE_ESTRANGEIRO: "Passaporte Estrangeiro",
    TRADUCAO_JURAMENTADA: "Tradução Juramentada",
    APOSTILA_HAIA: "Apostila de Haia",
  }
  return labels[tipo] || tipo
}

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

    // Buscar documento atual ANTES de atualizar (para comparar status)
    const documentoAtual = await prisma.documento.findUnique({
      where: { id },
      include: {
        pessoa: {
          select: {
            id: true,
            nome: true,
            sobrenome: true,
            arvore: {
              select: {
                id: true,
                processos: {
                  select: { id: true },
                  take: 1
                }
              }
            }
          }
        }
      }
    })

    if (!documentoAtual) {
      return NextResponse.json({ error: "Documento não encontrado" }, { status: 404 })
    }

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

    // ✅ ATUALIZADO: Automação - Criar tarefa quando status muda para SOLICITAR
    const statusMudouParaSolicitar = body.status === "SOLICITAR" && documentoAtual.status !== "SOLICITAR"

    if (statusMudouParaSolicitar) {
      const processoId = documentoAtual.pessoa.arvore?.processos[0]?.id

      if (processoId) {
        const tipoLabel = getTipoDocumentoLabel(documentoAtual.tipo)
        const nomePessoa = `${documentoAtual.pessoa.nome} ${documentoAtual.pessoa.sobrenome || ""}`.trim()

        // Buscar tarefa pai "Emissão da Pasta Documental"
        const tarefaPai = await prisma.tarefa.findFirst({
          where: {
            processoId,
            tarefaPaiId: null,
            titulo: {
              contains: 'Emissão',
              mode: 'insensitive'
            }
          }
        })

        await prisma.tarefa.create({
          data: {
            titulo: `Solicitar ${tipoLabel} - ${nomePessoa}`,
            descricao: `Solicitar ${tipoLabel} de ${nomePessoa}`,
            processoId,
            tarefaPaiId: tarefaPai?.id || null,
            prioridade: "MEDIA",
            concluida: false
          }
        })
      }
    }

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

// DELETE - Excluir documento E tarefa relacionada
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: idParam } = await params
    const id = Number.parseInt(idParam)

    if (isNaN(id)) {
      return NextResponse.json({ error: "ID inválido" }, { status: 400 })
    }

    // Buscar documento COM pessoa para encontrar a tarefa relacionada
    const documento = await prisma.documento.findUnique({
      where: { id },
      include: {
        pessoa: {
          select: {
            nome: true,
            sobrenome: true,
            arvore: {
              select: {
                processos: {
                  select: { id: true },
                  take: 1
                }
              }
            }
          }
        }
      }
    })

    if (!documento) {
      return NextResponse.json({ error: "Documento não encontrado" }, { status: 404 })
    }

    // Tentar excluir a tarefa relacionada (se existir)
    const processoId = documento.pessoa.arvore?.processos[0]?.id
    if (processoId) {
      const tipoLabel = getTipoDocumentoLabel(documento.tipo)
      const nomePessoa = `${documento.pessoa.nome} ${documento.pessoa.sobrenome || ""}`.trim()
      const tituloTarefa = `Solicitar ${tipoLabel} - ${nomePessoa}`

      // Buscar e excluir tarefa com título correspondente
      await prisma.tarefa.deleteMany({
        where: {
          processoId,
          titulo: tituloTarefa
        }
      })
    }

    // Excluir o documento
    await prisma.documento.delete({
      where: { id }
    })

    return NextResponse.json({ message: "Documento e tarefa excluídos com sucesso", id })
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

    // Buscar status anterior para automação
    const documentoAtual = await prisma.documento.findUnique({
      where: { id },
      include: {
        pessoa: {
          select: {
            nome: true,
            sobrenome: true,
            arvore: {
              select: {
                processos: {
                  select: { id: true },
                  take: 1
                }
              }
            }
          }
        }
      }
    })

    if (!documentoAtual) {
      return NextResponse.json({ error: "Documento não encontrado" }, { status: 404 })
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

    // ✅ ATUALIZADO: Automação - Criar tarefa quando status muda para SOLICITAR
    const statusMudouParaSolicitar = body.status === "SOLICITAR" && documentoAtual.status !== "SOLICITAR"

    if (statusMudouParaSolicitar) {
      const processoId = documentoAtual.pessoa.arvore?.processos[0]?.id

      if (processoId) {
        const tipoLabel = getTipoDocumentoLabel(documentoAtual.tipo)
        const nomePessoa = `${documentoAtual.pessoa.nome} ${documentoAtual.pessoa.sobrenome || ""}`.trim()

        // Buscar tarefa pai "Emissão da Pasta Documental"
        const tarefaPai = await prisma.tarefa.findFirst({
          where: {
            processoId,
            tarefaPaiId: null,
            titulo: {
              contains: 'Emissão',
              mode: 'insensitive'
            }
          }
        })

        await prisma.tarefa.create({
          data: {
            titulo: `Solicitar ${tipoLabel} - ${nomePessoa}`,
            descricao: `Solicitar ${tipoLabel} de ${nomePessoa}`,
            processoId,
            tarefaPaiId: tarefaPai?.id || null,
            prioridade: "MEDIA",
            concluida: false
          }
        })
      }
    }

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