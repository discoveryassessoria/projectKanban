// src/app/api/processos/[processoId]/custos/route.ts
//
// PLANILHA DOCUMENTAL-FINANCEIRA DO PROCESSO — projeção, nunca fonte.
//
// O QUE MUDOU E POR QUÊ
// ---------------------
// Este endpoint lia `prisma.custo` (o model legado) e criava seis TipoServico de
// nomes fixos dentro do GET. Em 28/07/2026, o motor passou a nascer V3-native
// (commit 4fca632e) e deixou de escrever no `Custo` legado: o leitor continuou
// apontado para uma tabela que ninguém mais alimenta, e a planilha zerou. Não foi
// a geração que morreu — foi a leitura que ficou órfã.
//
// Agora a fonte é a mesma que a aba Custos usa: as ObrigacaoEconomica do processo,
// com o vínculo documental (pessoa/documento/serviço) em coluna. As colunas de
// serviço são DERIVADAS do cadastro, não escritas aqui. E ler deixou de escrever:
// nenhuma linha é criada por um GET.
//
// A resposta preserva o formato legado (linhas/pessoas/servicos/totais) para não
// quebrar quem já consome, e acrescenta `planilha` com a projeção rica (blocos por
// pessoa, células por serviço, totais por linha/pessoa/processo).

import { type NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { verificarPermissao } from '@/src/lib/verificar-permissao'
import { montarPlanilhaDocumental } from '@/lib/financeiro/leitura/planilha-documental'


// GET — a planilha documental-financeira do processo (somente leitura).
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ processoId: string }> }
) {
  try {
    // A planilha é financeira: ver custo do processo exige permissão, como a lista.
    // O GET nunca teve gate — passava porque ninguém o alcançava pela tela morta.
    const erro = await verificarPermissao(request, 'financeiro.ver')
    if (erro) return erro

    const { processoId } = await params
    const id = parseInt(processoId)
    if (isNaN(id)) return NextResponse.json({ error: "ID inválido" }, { status: 400 })

    const processoExiste = await prisma.processo.findUnique({ where: { id }, select: { id: true } })
    if (!processoExiste) return NextResponse.json({ error: "Processo não encontrado" }, { status: 404 })

    // FONTE ÚNICA: a projeção. Tudo abaixo é formatação dela.
    const planilha = await montarPlanilhaDocumental(id)

    // ── Formato legado (preservado) ──────────────────────────────────────────
    // Uma linha por documento, com os valores por serviço num mapa. Derivado da
    // MESMA projeção: nenhum número aqui é calculado por um segundo caminho.
    const linhas = planilha.pessoas.flatMap((p) =>
      p.linhas.map((l, idx) => ({
        pessoaId: p.pessoaId,
        numeroLinhagem: p.numeroLinhagem ?? 999,
        nome: p.nome,
        tipoRegistro: l.tipoRegistro,
        data: l.dataRegistro,
        local: l.local ?? l.cartorio ?? '',
        cartorio: l.cartorio ?? '',
        livro: l.livro ?? '',
        folha: l.folha ?? '',
        termo: l.termo ?? '',
        dadosRegistro: l.livro || l.folha || l.termo
          ? `Livro ${l.livro || '-'} / Folhas ${l.folha || '-'} / Termo ${l.termo || '-'}`
          : '',
        conjuge: p.conjuges[0] ?? '',
        paiNome: p.paiNome,
        maeNome: p.maeNome,
        observacao: l.observacao ?? '',
        valores: Object.fromEntries(l.celulas.map((c) => [c.tipoServicoId, c.valorBrl])),
        total: l.totalBrl,
        isPrimeiraLinha: idx === 0,
        documentoId: l.documentoId,
        localizado: l.localizado,
      })),
    )

    return NextResponse.json({
      linhas,
      pessoas: planilha.pessoas.map((p) => ({
        id: p.pessoaId,
        nome: p.nome.split(' ')[0],
        sobrenome: p.nome.split(' ').slice(1).join(' '),
        nomeCompleto: p.nome,
        numeroLinhagem: p.numeroLinhagem ?? 999,
      })),
      servicos: planilha.colunas.map((c) => ({ id: c.tipoServicoId, nome: c.nome, ordem: c.ordem })),
      totaisPorServico: planilha.totaisPorServico,
      totalGeral: planilha.totalGeralBrl,
      // Projeção rica — o que a visão "Planilha documental" consome.
      planilha,
    })
  } catch (error) {
    console.error("Erro ao montar a planilha documental:", error)
    return NextResponse.json({ error: "Erro interno do servidor" }, { status: 500 })
  }
}

// POST - Salvar/Atualizar custo de uma pessoa para um serviço
// (mantém CustoPessoa: é a ENTRADA MANUAL / fallback. Não mexer no Passo 3.)
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ processoId: string }> }
) {
  try {
    const erro = await verificarPermissao(request, 'financeiro.custos_editar')
    if (erro) return erro

    const { processoId } = await params
    const procId = parseInt(processoId)

    if (isNaN(procId)) {
      return NextResponse.json({ error: "ID inválido" }, { status: 400 })
    }

    const body = await request.json()
    const { pessoaId, tipoServicoId, tipoRegistro, valor, observacao } = body

    if (!pessoaId || !tipoServicoId) {
      return NextResponse.json({ error: "pessoaId e tipoServicoId são obrigatórios" }, { status: 400 })
    }

    // ✅ ATUALIZADO: Incluir tipoRegistro no upsert
    const custo = await prisma.custoPessoa.upsert({
      where: {
        processoId_pessoaId_tipoServicoId_tipoRegistro: {
          processoId: procId,
          pessoaId: parseInt(pessoaId),
          tipoServicoId: parseInt(tipoServicoId),
          tipoRegistro: tipoRegistro || null
        }
      },
      update: {
        valor: valor || 0,
        observacao: observacao || null
      },
      create: {
        processoId: procId,
        pessoaId: parseInt(pessoaId),
        tipoServicoId: parseInt(tipoServicoId),
        tipoRegistro: tipoRegistro || null,
        valor: valor || 0,
        observacao: observacao || null
      }
    })

    return NextResponse.json(custo)
  } catch (error) {
    console.error("Erro ao salvar custo:", error)
    return NextResponse.json({ error: "Erro interno do servidor" }, { status: 500 })
  }
}

// PUT - Salvar múltiplos custos de uma vez (batch)
// (mantém CustoPessoa: entrada manual / fallback. Não mexer no Passo 3.)
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ processoId: string }> }
) {
  try {
    const erro = await verificarPermissao(request, 'financeiro.custos_editar')
    if (erro) return erro

    const { processoId } = await params
    const procId = parseInt(processoId)

    if (isNaN(procId)) {
      return NextResponse.json({ error: "ID inválido" }, { status: 400 })
    }

    const body = await request.json()
    const { custos } = body

    if (!Array.isArray(custos)) {
      return NextResponse.json({ error: "custos deve ser um array" }, { status: 400 })
    }

    // ✅ ATUALIZADO: Incluir tipoRegistro no upsert em batch
    const resultados = await Promise.all(
      custos.map(async (c: any) => {
        return prisma.custoPessoa.upsert({
          where: {
            processoId_pessoaId_tipoServicoId_tipoRegistro: {
              processoId: procId,
              pessoaId: parseInt(c.pessoaId),
              tipoServicoId: parseInt(c.tipoServicoId),
              tipoRegistro: c.tipoRegistro || '-'
            }
          },
          update: {
            valor: c.valor || 0,
            observacao: c.observacao || null
          },
          create: {
            processoId: procId,
            pessoaId: parseInt(c.pessoaId),
            tipoServicoId: parseInt(c.tipoServicoId),
            tipoRegistro: c.tipoRegistro || '-',
            valor: c.valor || 0,
            observacao: c.observacao || null
          }
        })
      })
    )

    return NextResponse.json({ message: "Custos salvos", count: resultados.length })
  } catch (error) {
    console.error("Erro ao salvar custos em batch:", error)
    return NextResponse.json({ error: "Erro interno do servidor" }, { status: 500 })
  }
}

// ✅ NOVO: PATCH para salvar ordem das pessoas
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ processoId: string }> }
) {
  try {
    const erro = await verificarPermissao(request, 'financeiro.custos_editar')
    if (erro) return erro

    const { ordens } = await request.json()

    // ordens é um array de { pessoaId: number, ordemCusto: number }
    if (!Array.isArray(ordens)) {
      return NextResponse.json({ error: "Dados inválidos" }, { status: 400 })
    }

    // Atualizar cada pessoa
    const resultados = await Promise.all(
      ordens.map(({ pessoaId, ordemCusto }: { pessoaId: number, ordemCusto: number }) =>
        prisma.pessoa.update({
          where: { id: pessoaId },
          data: { ordemCusto }
        })
      )
    )

    return NextResponse.json({ message: "Ordem salva", count: resultados.length })
  } catch (error) {
    console.error("Erro ao salvar ordem:", error)
    return NextResponse.json({ error: "Erro interno do servidor" }, { status: 500 })
  }
}