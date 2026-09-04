// AUTORIZAÇÃO SERVER-SIDE (B1).
// O middleware já exige JWT em toda rota /api, mas autenticado ≠ autorizado:
// sem esta guarda, qualquer usuário logado — independente do perfil — podia
// apagar a árvore inteira ou criar/excluir Pessoa. A UI escondia os botões; a
// API aceitava a chamada. Permissão de tela não é permissão de sistema.
// src/app/api/pessoas/route.ts

import { type NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { dispararMaterializacaoPorArvore } from "@/src/services/genealogia/materializar-genealogia"
import { ehRequerente } from "@/lib/genealogia/requerente-flag"
import { verificarPermissao } from "@/src/lib/verificar-permissao"
// LEGADO_INATIVO (desativação Genealogia): a auto-geração de Documento ao criar
// Pessoa foi DESLIGADA. Criar Pessoa NÃO gera mais Documento silenciosamente.
// Import de reconcileDocsForPessoa removido de propósito — não reintroduzir.

// GET - Listar pessoas (com filtros opcionais)
export async function GET(request: NextRequest) {
  const semPermissao = await verificarPermissao(request, "arvore.ver")
  if (semPermissao) return semPermissao

  try {
    const { searchParams } = new URL(request.url)
    const arvoreId = searchParams.get('arvoreId')
    // BUSCA NO CADASTRO MESTRE — usada pela checagem obrigatória de duplicidade
    // antes de criar Pessoa. Sem `arvoreId`, procura na base inteira: é esse o
    // ponto, achar a pessoa que já existe em OUTRA árvore/processo.
    const busca = (searchParams.get('busca') || '').trim()

    const where: any = {}
    if (arvoreId) {
      where.arvoreId = parseInt(arvoreId)
    }
    if (busca) {
      where.OR = [
        { nome: { contains: busca, mode: 'insensitive' } },
        { sobrenome: { contains: busca, mode: 'insensitive' } },
      ]
    }

    if (busca) {
      const candidatos = await prisma.pessoa.findMany({
        where,
        select: {
          id: true,
          nome: true,
          sobrenome: true,
          sexo: true,
          data_nasc: true,
          data_obito: true,
          local_nasc: true,
          pais_nasc: true,
          arvoreId: true,
          paiId: true,
          maeId: true,
          pai: { select: { id: true, nome: true, sobrenome: true } },
          mae: { select: { id: true, nome: true, sobrenome: true } },
        },
        orderBy: { nome: 'asc' },
        take: 40,
      })
      return NextResponse.json(candidatos)
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
  const semPermissao = await verificarPermissao(request, "arvore.criar")
  if (semPermissao) return semPermissao

  // MDM-3 F3 — TRAVA SERVER-SIDE DE DEDUPLICAÇÃO.
  //
  // Toda criação de Pessoa exige uma `DecisaoDeduplicacao` registrada. A trava
  // vive aqui, não na tela: enquanto o serviço de FUSÃO (MDM-4) não existir,
  // cada duplicata criada é permanente — e uma tela pode ser contornada por
  // qualquer chamada direta à API.
  //
  // Retrocompatível por transição: sem `decisaoDedupId` a criação segue, mas o
  // caso é REGISTRADO em log para o inventário de chamadores. Depois que os
  // consumidores estiverem migrados, este bloco vira 409 — a linha está pronta
  // logo abaixo, comentada, para a virada ser de uma linha só.
  const corpoBruto = await request.clone().json().catch(() => ({} as Record<string, unknown>))
  const decisaoDedupId = Number(corpoBruto?.decisaoDedupId ?? 0) || null

  if (decisaoDedupId) {
    const decisao = await prisma.decisaoDeduplicacao.findUnique({
      where: { id: decisaoDedupId },
      select: { id: true, decisao: true, nivelTriagem: true, pessoaResultanteId: true },
    })
    if (!decisao) {
      return NextResponse.json(
        { error: "decisaoDedupId inválido — refaça a triagem no Cadastro Mestre." },
        { status: 409 },
      )
    }
    if (decisao.decisao !== "CRIOU_NOVA") {
      return NextResponse.json(
        {
          error:
            "A decisão registrada foi VINCULAR uma Pessoa existente. Use o vínculo em vez de criar uma nova.",
          pessoaExistenteId: decisao.pessoaResultanteId,
        },
        { status: 409 },
      )
    }
  } else {
    console.warn(
      "[mdm-3] POST /api/pessoas sem decisaoDedupId — chamador ainda não migrado para a triagem oficial.",
    )
    // F3 final (após migrar todos os chamadores), trocar o warn acima por:
    // return NextResponse.json({ error: "Criação exige triagem no Cadastro Mestre (decisaoDedupId)." }, { status: 409 })
  }

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
        // INVARIANTE (dedup): uma Pessoa NUNCA nasce requerente por este endpoint
        // genérico — requerente é definido só pelo vínculo com o Processo
        // (ProcessoRequerente, via lib/genealogia/vincular-requerente). Aqui normaliza
        // qualquer tentativa para 'nao'. Fonte única de requerente = ProcessoRequerente.
        requerente: ehRequerente(requerente) ? 'nao' : (requerente || 'nao'),
        // Nº Linhagem nasce vazio: `dispararMaterializacaoPorArvore` (chamado logo
        // abaixo) já calcula e grava o valor certo — nunca é digitado.
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

    // NÃO HÁ TRANSIÇÃO A EMITIR AQUI, e não é omissão: o `create` acima normaliza
    // qualquer tentativa de nascer requerente para 'nao' (invariante de dedup —
    // requerente é definido pelo vínculo com o Processo, não por este endpoint
    // genérico). Existia neste ponto um bloco `if (ehRequerente(...)) emitir…` cuja
    // condição era, por construção, sempre falsa: uma terceira porta que nunca
    // abriu. Saiu com o import.

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
    // LEGADO_INATIVO: a auto-geração de Documento (reconcileDocsForPessoa /
    // DOCUMENT_RULES) segue DESATIVADA — criar Pessoa NÃO cria Documento.
    // ARQUITETURA NOVA (Fatia 2): reavalia as Regras Documentais publicadas e
    // materializa as NecessidadeDocumental da Genealogia (best-effort, idempotente,
    // não cria Documento, não avança fase). Nunca quebra o cadastro da Pessoa.
    // ============================================================
    await dispararMaterializacaoPorArvore(pessoa.arvoreId)

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