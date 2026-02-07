// src/app/api/documentos/route.ts
// ✅ ATUALIZADO: Automação para EM_BUSCA (cria tarefa de busca) e SOLICITAR (cria subtarefa dentro da busca)

import { type NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { TipoDocumento, StatusDocumento } from "@prisma/client"

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

// GET - Listar documentos (com filtros)
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const pessoaId = searchParams.get('pessoaId')
    const arvoreId = searchParams.get('arvoreId')
    const tipo = searchParams.get('tipo')
    const status = searchParams.get('status')

    const where: any = {}

    // Filtrar por pessoa
    if (pessoaId) {
      where.pessoaId = parseInt(pessoaId)
    }

    // Filtrar por árvore (busca pessoas dessa árvore)
    if (arvoreId) {
      where.pessoa = {
        arvoreId: parseInt(arvoreId)
      }
    }

    // Filtrar por tipo
    if (tipo && Object.values(TipoDocumento).includes(tipo as TipoDocumento)) {
      where.tipo = tipo
    }

    // Filtrar por status
    if (status && Object.values(StatusDocumento).includes(status as StatusDocumento)) {
      where.status = status
    }

    const documentos = await prisma.documento.findMany({
      where,
      include: {
        pessoa: {
          select: {
            id: true,
            nome: true,
            sobrenome: true,
            data_nasc: true,
            pais_nasc: true,
          }
        }
      },
      orderBy: [
        { status: 'asc' },
        { createdAt: 'desc' }
      ]
    })

    return NextResponse.json({ documentos })
  } catch (error) {
    console.error("Erro ao listar documentos:", error)
    return NextResponse.json({ error: "Erro interno do servidor" }, { status: 500 })
  }
}

// POST - Criar novo documento (COM AUTOMAÇÃO)
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()

    const {
      pessoaId,
      tipo,
      status,
      descricao,
      // Dados do registro (certidões)
      cartorio,
      livro,
      folha,
      termo,
      numero_registro,
      data_registro,
      data_evento,    // ← adicionar
      cidade_registro,
      estado_registro,
      pais_registro,
      // Documentos de identidade
      numero,
      orgao_emissor,
      data_emissao,
      data_validade,
      // Arquivo
      arquivo_url,
      arquivo_nome,
      arquivo_tamanho,
      arquivo_mime_type,
      // Tradução
      traduzido,
      tradutor,
      data_traducao,
      arquivo_traducao_url,
      arquivo_traducao_nome,
      // Apostilamento
      apostilado,
      numero_apostila,
      data_apostila,
      arquivo_apostila_url,
      // Observações
      observacoes,
    } = body

    // Validações
    if (!pessoaId) {
      return NextResponse.json({ error: "pessoaId é obrigatório" }, { status: 400 })
    }

    if (!tipo) {
      return NextResponse.json({ error: "tipo é obrigatório" }, { status: 400 })
    }

    // Verificar se o tipo é válido
    if (!Object.values(TipoDocumento).includes(tipo)) {
      return NextResponse.json(
        { error: "Tipo de documento inválido", tiposValidos: Object.values(TipoDocumento) },
        { status: 400 }
      )
    }

    // Buscar pessoa COM árvore e processos para automação
    const pessoa = await prisma.pessoa.findUnique({
      where: { id: parseInt(pessoaId) },
      include: {
        arvore: {
          include: {
            processos: {
              select: { id: true },
              take: 1
            }
          }
        }
      }
    })

    if (!pessoa) {
      return NextResponse.json({ error: "Pessoa não encontrada" }, { status: 404 })
    }

    const documento = await prisma.documento.create({
      data: {
        pessoaId: parseInt(pessoaId),
        tipo: tipo as TipoDocumento,
        status: (status as StatusDocumento) || 'PENDENTE',
        descricao: descricao || null,
        // Dados do registro
        cartorio: cartorio || null,
        livro: livro || null,
        folha: folha || null,
        termo: termo || null,
        numero_registro: numero_registro || null,
        data_registro: data_registro ? new Date(data_registro) : null,
        data_evento: data_evento ? new Date(data_evento) : null,    // ← adicionar
        cidade_registro: cidade_registro || null,
        estado_registro: estado_registro || null,
        pais_registro: pais_registro || null,
        // Documentos de identidade
        numero: numero || null,
        orgao_emissor: orgao_emissor || null,
        data_emissao: data_emissao ? new Date(data_emissao) : null,
        data_validade: data_validade ? new Date(data_validade) : null,
        // Arquivo
        arquivo_url: arquivo_url || null,
        arquivo_nome: arquivo_nome || null,
        arquivo_tamanho: arquivo_tamanho || null,
        arquivo_mime_type: arquivo_mime_type || null,
        // Tradução
        traduzido: traduzido || false,
        tradutor: tradutor || null,
        data_traducao: data_traducao ? new Date(data_traducao) : null,
        arquivo_traducao_url: arquivo_traducao_url || null,
        arquivo_traducao_nome: arquivo_traducao_nome || null,
        // Apostilamento
        apostilado: apostilado || false,
        numero_apostila: numero_apostila || null,
        data_apostila: data_apostila ? new Date(data_apostila) : null,
        arquivo_apostila_url: arquivo_apostila_url || null,
        // Observações
        observacoes: observacoes || null,
      },
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
    const statusFinal = (status as StatusDocumento) || 'PENDENTE'
    const processoId = pessoa.arvore?.processos[0]?.id

    if (processoId) {
      const tipoLabel = getTipoDocumentoLabel(tipo)
      const nomePessoa = `${pessoa.nome} ${pessoa.sobrenome || ""}`.trim()

      // Buscar tarefa pai "Emissão da Pasta Documental"
      const tarefaEmissao = await prisma.tarefa.findFirst({
        where: {
          processoId,
          tarefaPaiId: null,
          titulo: {
            contains: 'Emissão',
            mode: 'insensitive'
          }
        }
      })

      // ✅ Status EM_BUSCA: Criar tarefa de busca
      if (statusFinal === "EM_BUSCA") {
        await prisma.tarefa.create({
          data: {
            titulo: `Buscar ${tipoLabel} - ${nomePessoa}`,
            descricao: `Buscar ${tipoLabel} de ${nomePessoa}`,
            processoId,
            tarefaPaiId: tarefaEmissao?.id || null,
            prioridade: "MEDIA",
            concluida: false
          }
        })
      }

      // ✅ Status SOLICITAR: Criar tarefa de busca + subtarefa de solicitar
      if (statusFinal === "SOLICITAR") {
        // Primeiro, criar a tarefa de busca (se não existir)
        let tarefaBusca = await prisma.tarefa.findFirst({
          where: {
            processoId,
            titulo: `Buscar ${tipoLabel} - ${nomePessoa}`
          }
        })

        if (!tarefaBusca) {
          tarefaBusca = await prisma.tarefa.create({
            data: {
              titulo: `Buscar ${tipoLabel} - ${nomePessoa}`,
              descricao: `Buscar ${tipoLabel} de ${nomePessoa}`,
              processoId,
              tarefaPaiId: tarefaEmissao?.id || null,
              prioridade: "MEDIA",
              concluida: false
            }
          })
        }

        // Depois, criar a subtarefa de solicitar dentro da tarefa de busca
        await prisma.tarefa.create({
          data: {
            titulo: `Solicitar ${tipoLabel} - ${nomePessoa}`,
            descricao: `Solicitar ${tipoLabel} de ${nomePessoa}`,
            processoId,
            tarefaPaiId: tarefaBusca.id,
            prioridade: "MEDIA",
            concluida: false
          }
        })
      }
    }

    return NextResponse.json(documento, { status: 201 })
  } catch (error) {
    console.error("Erro ao criar documento:", error)
    return NextResponse.json({ error: "Erro interno do servidor" }, { status: 500 })
  }
}

// Endpoint para listar tipos e status disponíveis
export async function OPTIONS() {
  return NextResponse.json({
    tipos: Object.values(TipoDocumento),
    status: Object.values(StatusDocumento),
  })
}