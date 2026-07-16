// src/app/api/pessoas/route.ts

import { type NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
// LEGADO_INATIVO (desativação Genealogia): a auto-geração de Documento ao criar
// Pessoa foi DESLIGADA. Criar Pessoa NÃO gera mais Documento silenciosamente.
// Import de reconcileDocsForPessoa removido de propósito — não reintroduzir.

// GET - Listar pessoas (com filtros opcionais)
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const arvoreId = searchParams.get('arvoreId')

    const where: any = {}
    if (arvoreId) {
      where.arvoreId = parseInt(arvoreId)
    }

    const pessoas = await prisma.pessoa.findMany({
      where,
      include: {
        pai: {
          include: {
            pai: true,
            mae: true
          }
        },
        mae: {
          include: {
            pai: true,
            mae: true
          }
        },
        filhosComoPai: true,
        filhosComoMae: true,
        documentos: {
          orderBy: { createdAt: 'desc' }
        },
      },
      orderBy: { id: 'asc' }
    })

    return NextResponse.json({ pessoas })
  } catch (error) {
    console.error("Erro ao listar pessoas:", error)
    return NextResponse.json({ error: "Erro interno do servidor" }, { status: 500 })
  }
}

// POST - Criar nova pessoa
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()

    const {
      // Campos existentes
      nome,
      sobrenome,
      sexo,
      data_nasc,
      local_nasc,
      data_obito,
      batizado,
      comentario,
      arvoreId,
      paiId,
      maeId,
      x,
      y,
      filhoId,
      tipoPai,

      // ✅ NOVOS CAMPOS
      estado_nasc,
      pais_nasc,
      vivo,
      data_batismo,
      local_batismo,
      igreja_batismo,
      profissao,
      nacionalidade,
      cidadanias_outras,
      naturalizado,
      data_naturalizacao,
      pais_naturalizacao,
      data_emigracao,
      local_emigracao,
      porto_embarque,
      data_chegada,
      porto_chegada,
      pais_destino,
      navio,

      // ✅ NOVO: Requerente e Linhagem
      requerente,
      numeroLinhagem,
      linhaReta,
      documentacao,

      // ✅ NOVO (rodada 3): flag de casamento pra engine
      casado,
    } = body

    if (!nome) {
      return NextResponse.json({ error: "Nome é obrigatório" }, { status: 400 })
    }

    if (!arvoreId) {
      return NextResponse.json({ error: "arvoreId é obrigatório" }, { status: 400 })
    }

    // Verificar se a árvore existe
    const arvore = await prisma.arvore.findUnique({
      where: { id: arvoreId }
    })

    if (!arvore) {
      return NextResponse.json({ error: "Árvore não encontrada" }, { status: 404 })
    }

    // Criar a pessoa com todos os campos
    const pessoa = await prisma.pessoa.create({
      data: {
        // Campos existentes
        nome,
        sobrenome: sobrenome || null,
        sexo: sexo || null,
        data_nasc: data_nasc ? new Date(data_nasc) : null,
        local_nasc: local_nasc || null,
        data_obito: data_obito ? new Date(data_obito) : null,
        batizado: batizado || null,
        comentario: comentario || null,
        arvoreId,
        paiId: paiId || null,
        maeId: maeId || null,
        x: x || null,
        y: y || null,

        // ✅ NOVOS CAMPOS
        estado_nasc: estado_nasc || null,
        pais_nasc: pais_nasc || null,
        vivo: vivo !== undefined ? vivo : true,
        data_batismo: data_batismo ? new Date(data_batismo) : null,
        local_batismo: local_batismo || null,
        igreja_batismo: igreja_batismo || null,
        profissao: profissao || null,
        nacionalidade: nacionalidade || null,
        cidadanias_outras: cidadanias_outras || null,
        naturalizado: naturalizado || false,
        data_naturalizacao: data_naturalizacao ? new Date(data_naturalizacao) : null,
        pais_naturalizacao: pais_naturalizacao || null,
        data_emigracao: data_emigracao ? new Date(data_emigracao) : null,
        local_emigracao: local_emigracao || null,
        porto_embarque: porto_embarque || null,
        data_chegada: data_chegada ? new Date(data_chegada) : null,
        porto_chegada: porto_chegada || null,
        pais_destino: pais_destino || null,
        navio: navio || null,

        // ✅ Requerente e Linhagem
        requerente: requerente || 'nao',
        numeroLinhagem: numeroLinhagem ? parseInt(numeroLinhagem) : null,
        linhaReta: linhaReta ?? true,
        documentacao: documentacao ?? true,

        // ✅ NOVO (rodada 3): flag de casado
        casado: casado === true,
      },
      include: {
        pai: true,
        mae: true,
        filhosComoPai: true,
        filhosComoMae: true,
        documentos: true,
      }
    })

    // Se está adicionando como pai ou mãe de um filho existente
    if (filhoId && tipoPai) {
      const updateData: any = {}
      if (tipoPai === 'pai') {
        updateData.paiId = pessoa.id
      } else if (tipoPai === 'mae') {
        updateData.maeId = pessoa.id
      }

      await prisma.pessoa.update({
        where: { id: filhoId },
        data: updateData
      })
    }

    // Se é a primeira pessoa da árvore, definir como pessoa principal
    const countPessoas = await prisma.pessoa.count({
      where: { arvoreId }
    })

    if (countPessoas === 1 && !arvore.pessoaPrincipalId) {
      await prisma.arvore.update({
        where: { id: arvoreId },
        data: { pessoaPrincipalId: pessoa.id }
      })
    }

    // ============================================================
    // LEGADO_INATIVO (desativação da lógica antiga da Genealogia)
    // ============================================================
    // A auto-geração de Documento (reconcileDocsForPessoa / DOCUMENT_RULES) foi
    // DESATIVADA. Criar Pessoa não cria mais Documento automaticamente. A
    // arquitetura documental definitiva ainda não foi aprovada — não religar
    // aqui nenhum gerador. Documento passa a ser criado apenas manualmente.

    // Recarrega a pessoa (documentos existentes, se houver — nada é gerado aqui)
    const pessoaFinal = await prisma.pessoa.findUnique({
      where: { id: pessoa.id },
      include: {
        pai: true,
        mae: true,
        filhosComoPai: true,
        filhosComoMae: true,
        documentos: { orderBy: { createdAt: 'desc' } },
      }
    })

    return NextResponse.json(pessoaFinal, { status: 201 })
  } catch (error) {
    console.error("Erro ao criar pessoa:", error)
    return NextResponse.json({ error: "Erro interno do servidor" }, { status: 500 })
  }
}