// src/app/api/processos/[processoId]/custos/route.ts

import { type NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

// Serviços padrão que serão criados automaticamente
const SERVICOS_PADRAO = [
  { nome: "Certidão Inteiro Teor", ordem: 0 },
  { nome: "Desmaterialização", ordem: 1 },
  { nome: "Apostilamento Certidão", ordem: 2 },
  { nome: "Tradução Juramentada", ordem: 3 },
  { nome: "Apostilamento Tradução", ordem: 4 },
  { nome: "Retificação", ordem: 5 },
]

// GET - Listar todos os custos do processo (apenas pessoas com documentos)
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ processoId: string }> }
) {
  try {
    const { processoId } = await params
    const id = parseInt(processoId)

    if (isNaN(id)) {
      return NextResponse.json({ error: "ID inválido" }, { status: 400 })
    }

    // Verificar se processo existe
    const processoExiste = await prisma.processo.findUnique({
      where: { id },
      select: { id: true }
    })

    if (!processoExiste) {
      return NextResponse.json({ error: "Processo não encontrado" }, { status: 404 })
    }

    // Buscar serviços existentes
    let servicos = await prisma.tipoServico.findMany({
      where: { processoId: id },
      orderBy: { ordem: 'asc' }
    })

    // Se não existem tipos de serviço, criar os padrão usando transação
    if (servicos.length === 0) {
      servicos = await prisma.$transaction(async (tx) => {
        // Verificar novamente dentro da transação
        const countExistente = await tx.tipoServico.count({
          where: { processoId: id }
        })

        if (countExistente === 0) {
          // Criar serviços padrão um por um para garantir
          for (const s of SERVICOS_PADRAO) {
            await tx.tipoServico.create({
              data: {
                processoId: id,
                nome: s.nome,
                ordem: s.ordem
              }
            })
          }
        }

        // Retornar os serviços (recém-criados ou existentes)
        return tx.tipoServico.findMany({
          where: { processoId: id },
          orderBy: { ordem: 'asc' }
        })
      })
    }

    // Buscar pessoas da árvore com contagem de documentos
    const processo = await prisma.processo.findUnique({
      where: { id },
      include: {
        arvore: {
          include: {
            pessoas: {
              select: {
                id: true,
                nome: true,
                sobrenome: true,
                _count: {
                  select: { documentos: true }
                }
              },
              orderBy: { id: 'asc' }
            }
          }
        },
        custosPessoa: true
      }
    })

    // Filtrar apenas pessoas que têm documentos
    const todasPessoas = processo?.arvore?.pessoas || []
    const pessoasComDocumentos = todasPessoas.filter(p => p._count.documentos > 0)
    
    const custos = processo?.custosPessoa || []

    // Criar mapa de custos para acesso rápido
    const custosMap: Record<string, { valor: number; observacao: string | null }> = {}
    custos.forEach(c => {
      const key = `${c.pessoaId}-${c.tipoServicoId}`
      custosMap[key] = { 
        valor: Number(c.valor), 
        observacao: c.observacao 
      }
    })

    // Calcular totais por pessoa (apenas pessoas com documentos)
    const pessoasComTotais = pessoasComDocumentos.map(pessoa => {
      let total = 0
      const valoresPorServico: Record<number, number> = {}
      
      servicos.forEach(servico => {
        const key = `${pessoa.id}-${servico.id}`
        const valor = custosMap[key]?.valor || 0
        valoresPorServico[servico.id] = valor
        total += valor
      })

      return {
        id: pessoa.id,
        nome: pessoa.nome,
        sobrenome: pessoa.sobrenome,
        nomeCompleto: `${pessoa.nome} ${pessoa.sobrenome || ''}`.trim(),
        valores: valoresPorServico,
        total,
        qtdDocumentos: pessoa._count.documentos
      }
    })

    // Calcular totais por serviço
    const totaisPorServico: Record<number, number> = {}
    servicos.forEach(servico => {
      totaisPorServico[servico.id] = pessoasComDocumentos.reduce((acc, pessoa) => {
        const key = `${pessoa.id}-${servico.id}`
        return acc + (custosMap[key]?.valor || 0)
      }, 0)
    })

    // Total geral
    const totalGeral = Object.values(totaisPorServico).reduce((acc, val) => acc + val, 0)

    return NextResponse.json({
      pessoas: pessoasComTotais,
      servicos,
      custosMap,
      totaisPorServico,
      totalGeral
    })
  } catch (error) {
    console.error("Erro ao listar custos:", error)
    return NextResponse.json({ error: "Erro interno do servidor" }, { status: 500 })
  }
}

// POST/PUT - Salvar/Atualizar custo de uma pessoa para um serviço
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ processoId: string }> }
) {
  try {
    const { processoId } = await params
    const procId = parseInt(processoId)

    if (isNaN(procId)) {
      return NextResponse.json({ error: "ID inválido" }, { status: 400 })
    }

    const body = await request.json()
    const { pessoaId, tipoServicoId, valor, observacao } = body

    if (!pessoaId || !tipoServicoId) {
      return NextResponse.json({ error: "pessoaId e tipoServicoId são obrigatórios" }, { status: 400 })
    }

    // Upsert - cria ou atualiza
    const custo = await prisma.custoPessoa.upsert({
      where: {
        processoId_pessoaId_tipoServicoId: {
          processoId: procId,
          pessoaId: parseInt(pessoaId),
          tipoServicoId: parseInt(tipoServicoId)
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
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ processoId: string }> }
) {
  try {
    const { processoId } = await params
    const procId = parseInt(processoId)

    if (isNaN(procId)) {
      return NextResponse.json({ error: "ID inválido" }, { status: 400 })
    }

    const body = await request.json()
    const { custos } = body // Array de { pessoaId, tipoServicoId, valor, observacao }

    if (!Array.isArray(custos)) {
      return NextResponse.json({ error: "custos deve ser um array" }, { status: 400 })
    }

    // Processar cada custo
    const resultados = await Promise.all(
      custos.map(async (c: any) => {
        return prisma.custoPessoa.upsert({
          where: {
            processoId_pessoaId_tipoServicoId: {
              processoId: procId,
              pessoaId: parseInt(c.pessoaId),
              tipoServicoId: parseInt(c.tipoServicoId)
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