// src/app/api/documentos/[id]/route.ts
// ✅ ATUALIZADO: Automação para EM_BUSCA (cria tarefa de busca) e SOLICITAR (cria subtarefa dentro da busca)
// ✅ FIX (rodada 10): whitelist do PUT inclui os 12 campos da rodada 6 (editor registral) +
//    rodada 9 (solicitar certidão). Sem isso, esses campos eram silenciosamente ignorados.

import { type NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { Prisma, TipoDocumento, StatusDocumento } from "@prisma/client"
import { verificarPermissao } from '@/src/lib/verificar-permissao'

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

// ✅ Helper para criar tarefas de documento
async function criarTarefasDocumento(
  statusNovo: string,
  tipo: string,
  nomePessoa: string,
  processoId: number
) {
  // Só para certidões inteiro teor
  const certidoesInteiroTeor = [
    'CERTIDAO_NASCIMENTO_INTEIRO_TEOR',
    'CERTIDAO_CASAMENTO_INTEIRO_TEOR',
    'CERTIDAO_OBITO_INTEIRO_TEOR'
  ]
  if (!certidoesInteiroTeor.includes(tipo)) return

  // Só dispara em EM_BUSCA ou SOLICITAR
  if (statusNovo !== 'EM_BUSCA' && statusNovo !== 'SOLICITAR') return

  const tipoLabel = getTipoDocumentoLabel(tipo)
  const tituloTarefaPai = `${tipoLabel} - ${nomePessoa}`

  // Só cria se não existir
  const tarefaExistente = await prisma.tarefa.findFirst({
    where: { processoId, titulo: tituloTarefaPai }
  })
  if (tarefaExistente) return

  // Buscar tarefa pai "Emissão da Pasta Documental"
  const tarefaEmissao = await prisma.tarefa.findFirst({
    where: {
      processoId,
      tarefaPaiId: null,
      titulo: { contains: 'Emissão', mode: 'insensitive' }
    }
  })

  // Criar tarefa pai
  const tarefaPai = await prisma.tarefa.create({
    data: {
      titulo: tituloTarefaPai,
      descricao: `${tipoLabel} de ${nomePessoa}`,
      processoId,
      tarefaPaiId: tarefaEmissao?.id || null,
      prioridade: "MEDIA",
      concluida: false
    }
  })

  // Criar 5 subtarefas
  const subtarefas = [
    'Buscar certidão em inteiro teor',
    'Preencher e assinar requerimento da solicitação da certidão em inteiro teor',
    'Enviar ao cartório requerimento da solicitação da certidão em inteiro teor',
    'Enviar ao CRC requerimento da solicitação da certidão em inteiro teor',
    'Receber certidão em inteiro teor',
  ]

  for (const titulo of subtarefas) {
    await prisma.tarefa.create({
      data: {
        titulo,
        processoId,
        tarefaPaiId: tarefaPai.id,
        prioridade: "MEDIA",
        concluida: false
      }
    })
  }
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
        },
        responsavel: {
          select: { id: true, nome: true, email: true }
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
    const erro = await verificarPermissao(request, 'arvore.editar_documento')
    if (erro) return erro

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

    // Tipo — LOTE C: aceita documentTypeId (tipo novo, do cadastro) OU tipo do enum.
    if (body.documentTypeId !== undefined) {
      const tc = await prisma.tipoDocumentoCadastro.findUnique({
        where: { id: parseInt(String(body.documentTypeId)) },
        select: { id: true, legacyEnumKey: true },
      })
      if (!tc) {
        return NextResponse.json({ error: "documentTypeId inválido (tipo não cadastrado)" }, { status: 400 })
      }
      dataToUpdate.documentType = { connect: { id: tc.id } }
      // dual-write: se o tipo tem equivalente no enum, também atualiza o legado; senão, limpa
      dataToUpdate.tipo = (tc.legacyEnumKey && Object.values(TipoDocumento).includes(tc.legacyEnumKey as TipoDocumento))
        ? (tc.legacyEnumKey as TipoDocumento)
        : null
    } else if (body.tipo !== undefined) {
      if (!Object.values(TipoDocumento).includes(body.tipo)) {
        return NextResponse.json({ error: "Tipo de documento inválido" }, { status: 400 })
      }
      dataToUpdate.tipo = body.tipo
      // liga o cadastro correspondente, se houver (dual-write)
      const equiv = await prisma.tipoDocumentoCadastro.findFirst({ where: { legacyEnumKey: String(body.tipo) }, select: { id: true } })
      if (equiv) dataToUpdate.documentType = { connect: { id: equiv.id } }
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
    if (body.data_evento !== undefined) dataToUpdate.data_evento = body.data_evento ? new Date(body.data_evento) : null
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

    // ============================================================
    // ✅ NOVO (rodada 6): Editor Registral — 11 campos canônicos
    // ============================================================
    // Identificação literal (como aparece na certidão)
    if (body.nome_registrado !== undefined) dataToUpdate.nome_registrado = body.nome_registrado
    if (body.pai_registrado !== undefined) dataToUpdate.pai_registrado = body.pai_registrado
    if (body.mae_registrada !== undefined) dataToUpdate.mae_registrada = body.mae_registrada
    if (body.conjuge_registrado !== undefined) dataToUpdate.conjuge_registrado = body.conjuge_registrado

    // Localidade extra
    if (body.comune !== undefined) dataToUpdate.comune = body.comune

    // Referência registral extra
    if (body.matricula !== undefined) dataToUpdate.matricula = body.matricula
    if (body.crc !== undefined) dataToUpdate.crc = body.crc
    if (body.protocolo !== undefined) dataToUpdate.protocolo = body.protocolo

    // Rastreamento da solicitação ao cartório
    if (body.nro_pedido !== undefined) dataToUpdate.nro_pedido = body.nro_pedido
    if (body.canal_solicitacao !== undefined) dataToUpdate.canal_solicitacao = body.canal_solicitacao
    if (body.link_acompanhamento !== undefined) dataToUpdate.link_acompanhamento = body.link_acompanhamento
    if (body.localizacao_fisica !== undefined) dataToUpdate.localizacao_fisica = body.localizacao_fisica

    // ============================================================
    // ✅ NOVO (rodada 12): Dados literais do documento (Etapa 5 Conferir)
    // ============================================================
    if (body.data_evento_documento !== undefined) {
      dataToUpdate.data_evento_documento = body.data_evento_documento
        ? new Date(body.data_evento_documento)
        : null
    }
    if (body.data_registro_documento !== undefined) {
      dataToUpdate.data_registro_documento = body.data_registro_documento
        ? new Date(body.data_registro_documento)
        : null
    }

    // ============================================================
    // ✅ Campos de operação (Central Operacional)
    // ============================================================
    if (body.responsavelId !== undefined) {
      dataToUpdate.responsavel = body.responsavelId
        ? { connect: { id: body.responsavelId } }
        : { disconnect: true }
    }
    if (body.dataPrazoOperacao !== undefined) {
      dataToUpdate.dataPrazoOperacao = body.dataPrazoOperacao
        ? new Date(body.dataPrazoOperacao)
        : null
    }
    if (body.dataInicioOperacao !== undefined) {
      dataToUpdate.dataInicioOperacao = body.dataInicioOperacao
        ? new Date(body.dataInicioOperacao)
        : null
    }
    if (body.motivoBloqueio !== undefined) {
      dataToUpdate.motivoBloqueio = body.motivoBloqueio?.trim() || null
    }
    // Marca movimentação sempre que algo é editado
    dataToUpdate.ultimaMovimentacao = new Date()

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

    // ✅ AUTOMAÇÃO DE TAREFAS
    if (body.status !== undefined) {
      const processoId = documentoAtual.pessoa.arvore?.processos[0]?.id

      if (processoId) {
        const nomePessoa = `${documentoAtual.pessoa.nome} ${documentoAtual.pessoa.sobrenome || ""}`.trim()
        await criarTarefasDocumento(body.status, documentoAtual.tipo ?? "", nomePessoa, processoId)
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

// DELETE - Excluir documento E tarefas relacionadas
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const erro = await verificarPermissao(request, 'arvore.excluir_documento')
    if (erro) return erro

    const { id: idParam } = await params
    const id = Number.parseInt(idParam)

    if (isNaN(id)) {
      return NextResponse.json({ error: "ID inválido" }, { status: 400 })
    }

    // Buscar documento COM pessoa para encontrar as tarefas relacionadas
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

    // Tentar excluir as tarefas relacionadas (se existirem)
    const processoId = documento.pessoa.arvore?.processos[0]?.id
    if (processoId) {
      const tipoLabel = getTipoDocumentoLabel(documento.tipo ?? "")
      const nomePessoa = `${documento.pessoa.nome} ${documento.pessoa.sobrenome || ""}`.trim()

      // Buscar tarefa de busca
      const tarefaBusca = await prisma.tarefa.findFirst({
        where: {
          processoId,
          titulo: `${tipoLabel} - ${nomePessoa}`
        }
      })

      if (tarefaBusca) {
        // Primeiro excluir subtarefas (solicitar)
        await prisma.tarefa.deleteMany({
          where: {
            processoId,
            tarefaPaiId: tarefaBusca.id
          }
        })

        // Depois excluir a tarefa de busca
        await prisma.tarefa.delete({
          where: { id: tarefaBusca.id }
        })
      }

      // Fallback: excluir tarefas antigas com título "Solicitar..." (caso existam)
      await prisma.tarefa.deleteMany({
        where: {
          processoId,
          titulo: `Solicitar ${tipoLabel} - ${nomePessoa}`
        }
      })
    }

    // Excluir o documento
    await prisma.documento.delete({
      where: { id }
    })

    return NextResponse.json({ message: "Documento e tarefas excluídos com sucesso", id })
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
    const erro = await verificarPermissao(request, 'arvore.editar_documento')
    if (erro) return erro

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

    // ✅ AUTOMAÇÃO DE TAREFAS
    const processoId = documentoAtual.pessoa.arvore?.processos[0]?.id

    if (processoId) {
      const nomePessoa = `${documentoAtual.pessoa.nome} ${documentoAtual.pessoa.sobrenome || ""}`.trim()
      await criarTarefasDocumento(body.status, documentoAtual.tipo ?? "", nomePessoa, processoId)
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