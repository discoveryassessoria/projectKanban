// src/app/api/documentos/[id]/route.ts
// ✅ ATUALIZADO: Automação para EM_BUSCA (cria tarefa de busca) e SOLICITAR (cria subtarefa dentro da busca)
// ✅ FIX (rodada 10): whitelist do PUT inclui os 12 campos da rodada 6 (editor registral) +
//    rodada 9 (solicitar certidão). Sem isso, esses campos eram silenciosamente ignorados.

import { type NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { Prisma, TipoDocumento, StatusDocumento } from "@prisma/client"
import { verificarPermissao } from '@/src/lib/verificar-permissao'
import { reconciliarEconomicoDoProcesso } from '@/src/lib/motor/matriz-economica'
import { notificarDocumentoAlterado } from '@/src/services/registral/gancho-documental'
import { removerDocumento } from '@/src/services/documento-operacional'

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
/**
 * A ÁRVORE PAI/FILHO DE TAREFAS FOI REMOVIDA DAQUI.
 *
 * Este bloco criava uma tarefa "pai" para o documento e CINCO subtarefas com os
 * nomes das etapas do workflow — "Buscar certidão", "Preencher requerimento",
 * "Enviar ao cartório"... Era etapa fingindo ser tarefa: a mesma certidão virava
 * seis linhas na fila, com seis prazos e nenhum workflow por trás.
 *
 * Hoje a tarefa nasce da OBRIGAÇÃO documental, uma por documento, e as etapas
 * vivem dentro dela como passos do workflow publicado. Criar documento não cria
 * tarefa: quem materializa é o motor, quando a obrigação vira executável.
 */

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
      }
    }

    // MRG — RECONCILIAÇÃO CONTÍNUA: documento alterado (dados registrais, status,
    // tradução, apostila) revalida identidade, fatos, integridade e linhagem.
    // Best-effort e sem efeito na resposta.
    notificarDocumentoAlterado({ documentoId: documentoAtualizado.id, motivo: 'documento_alterado' }).catch((e) =>
      console.error('[doc alterado → gancho registral]', e),
    )

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

    // O processo vem pela ÁRVORE da pessoa — é o vínculo que existe por ID.
    const documento = await prisma.documento.findUnique({
      where: { id },
      select: { id: true, pessoa: { select: { arvore: { select: { processos: { select: { id: true }, take: 1 } } } } } },
    })

    if (!documento) {
      return NextResponse.json({ error: "Documento não encontrado" }, { status: 404 })
    }

    const processoId = documento.pessoa.arvore?.processos[0]?.id

    // A remoção — documento, tarefas, passos e vínculo financeiro — vive no
    // serviço canônico, POR ID. A versão anterior desta rota procurava a tarefa
    // por igualdade de TÍTULO (`"${tipoLabel} - ${nomePessoa}"`): rótulo mudado
    // ou nome editado e a tarefa ficava órfã na fila ativa.
    const removido = await prisma.$transaction((tx) => removerDocumento(id, tx))

    // GRANULARIDADE POR DOCUMENTO: documento removido → o motor remove os lançamentos
    // que dependiam dele (reconcile). Best-effort, não bloqueia a resposta.
    if (processoId) reconciliarEconomicoDoProcesso(processoId).catch((e) => console.error('[doc removido → reconcile econômico]', e))

    return NextResponse.json({ message: "Documento e tarefas excluídos com sucesso", id, removidos: removido })
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
    }

    // GRANULARIDADE POR DOCUMENTO: mudança de status (ex.: cancelado/invalidado) muda a
    // elegibilidade → reconcilia (cria/remove os lançamentos). Best-effort.
    if (processoId) reconciliarEconomicoDoProcesso(processoId).catch((e) => console.error('[doc alterado → reconcile econômico]', e))

    // MRG — mudança de status documental (inválido, não encontrado, cancelado)
    // muda o que está comprovado: revalida a linhagem e as necessidades.
    notificarDocumentoAlterado({
      documentoId: documentoAtualizado.id,
      motivo: body.status === 'INVALIDO' || body.status === 'CANCELADO' ? 'documento_invalidado' : 'documento_alterado',
    }).catch((e) => console.error('[status doc → gancho registral]', e))

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