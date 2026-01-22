// src/app/api/processos/[processoId]/faturas/route.ts

import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

// GET - Listar faturas do processo
export async function GET(
  request: Request,
  { params }: { params: Promise<{ processoId: string }> }
) {
  try {
    const { processoId } = await params
    const id = parseInt(processoId)

    if (isNaN(id)) {
      return NextResponse.json(
        { error: "ID inválido" },
        { status: 400 }
      )
    }

    const faturasDb = await prisma.fatura.findMany({
      where: { processoId: id },
      include: {
        pagamentos: {
          orderBy: { data: 'asc' }
        }
      },
      orderBy: { dataVencimento: 'asc' }
    })

    const hoje = new Date()
    hoje.setHours(0, 0, 0, 0)

    // Processar faturas: calcular valorPago e verificar vencimento
    const faturas = await Promise.all(
      faturasDb.map(async (f) => {
        // Calcular valor pago como soma dos pagamentos
        const valorPago = f.pagamentos.reduce((acc, p) => acc + Number(p.valor), 0)
        const valorFatura = Number(f.valor)
        
        // Determinar status correto
        let statusAtualizado = f.status
        
        if (valorPago >= valorFatura - 0.01) {
          statusAtualizado = 'PAGO'
        } else if (valorPago > 0) {
          statusAtualizado = 'PARCIAL'
        } else if (f.dataVencimento) {
          const dataVenc = new Date(f.dataVencimento)
          dataVenc.setHours(0, 0, 0, 0)
          if (dataVenc < hoje) {
            statusAtualizado = 'VENCIDO'
          } else {
            statusAtualizado = 'PENDENTE'
          }
        }
        
        // Atualizar no banco se mudou
        if (statusAtualizado !== f.status) {
          await prisma.fatura.update({
            where: { id: f.id },
            data: { status: statusAtualizado }
          })
        }
        
        // Retornar fatura com dados calculados
        return {
          ...f,
          status: statusAtualizado,
          valorPago,
          valorRestante: valorFatura - valorPago
        }
      })
    )

    // Calcular totais
    const agora = new Date()
    agora.setHours(0, 0, 0, 0)
    
    let totalGeral = 0
    let totalPago = 0
    let totalPendente = 0
    let totalVencido = 0

    faturas.forEach(f => {
      const valorFatura = Number(f.valor)
      const valorPago = Number(f.valorPago)

      totalGeral += valorFatura
      totalPago += valorPago

      const restante = valorFatura - valorPago
      
      // Se ainda tem valor a pagar
      if (restante > 0.01) {
        totalPendente += restante
        
        // Verificar se está vencido pela DATA, não pelo status
        if (f.dataVencimento) {
          const dataVenc = new Date(f.dataVencimento)
          dataVenc.setHours(0, 0, 0, 0)
          if (dataVenc < hoje) {
            totalVencido += restante
          }
        }
      }
    })

    const totais = {
      total: totalGeral,
      pago: totalPago,
      pendente: totalPendente,
      vencido: totalVencido,
    }

    return NextResponse.json({ faturas, totais })
  } catch (error) {
    console.error('Erro ao buscar faturas:', error)
    return NextResponse.json(
      { error: "Erro ao buscar faturas" },
      { status: 500 }
    )
  }
}

// POST - Criar nova fatura
export async function POST(
  request: Request,
  { params }: { params: Promise<{ processoId: string }> }
) {
  try {
    const { processoId } = await params
    const id = parseInt(processoId)

    if (isNaN(id)) {
      return NextResponse.json(
        { error: "ID inválido" },
        { status: 400 }
      )
    }

    const body = await request.json()
    const { 
      descricao, 
      valor, 
      dataVencimento,
      observacoes 
    } = body

    if (!descricao || !valor) {
      return NextResponse.json(
        { error: "Descrição e valor são obrigatórios" },
        { status: 400 }
      )
    }

    // Verificar se processo existe
    const processo = await prisma.processo.findUnique({
      where: { id }
    })

    if (!processo) {
      return NextResponse.json(
        { error: "Processo não encontrado" },
        { status: 404 }
      )
    }

    const fatura = await prisma.fatura.create({
      data: {
        processoId: id,
        descricao,
        valor: parseFloat(valor),
        dataVencimento: dataVencimento ? new Date(dataVencimento + 'T12:00:00') : null,
        observacoes: observacoes || null,
        status: 'PENDENTE'
      }
    })

    return NextResponse.json({ fatura }, { status: 201 })
  } catch (error) {
    console.error('Erro ao criar fatura:', error)
    return NextResponse.json(
      { error: "Erro ao criar fatura" },
      { status: 500 }
    )
  }
}