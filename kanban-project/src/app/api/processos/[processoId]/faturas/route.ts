// src/app/api/processos/[processoId]/faturas/route.ts

import { prisma } from "@/lib/prisma"
import { NextRequest, NextResponse } from "next/server"
import { Decimal } from "@prisma/client/runtime/library"

// ========================================
// HELPER: Converter Decimal para number
// ========================================
function toNumber(value: Decimal | number | string | null | undefined): number {
  if (value === null || value === undefined) return 0
  if (typeof value === 'number') return value
  if (typeof value === 'string') return parseFloat(value) || 0
  return parseFloat(value.toString()) || 0
}

// ========================================
// GET - Listar faturas do processo
// ========================================
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ processoId: string }> }
) {
  try {
    const { processoId } = await params
    const processoIdNum = parseInt(processoId)

    const faturas = await prisma.fatura.findMany({
      where: { processoId: processoIdNum },
      include: {
        pagamentos: {
          orderBy: { data: 'desc' }
        },
        destinatarios: {
          include: {
            requerente: {
              select: {
                id: true,
                nome: true,
                cpf: true,
                endereco: true,
                numero: true,
                bairro: true,
                cidade: true,
                estado: true,
                cep: true
              }
            }
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    })

    // Calcular totais e status
    const faturasComCalculos = faturas.map(fatura => {
      const valorTotal = toNumber(fatura.valor)
      const valorPago = fatura.pagamentos.reduce(
        (sum: number, pag: { valor: Decimal | number | string | null }) => sum + toNumber(pag.valor), 
        0
      )
      const valorRestante = Math.max(0, valorTotal - valorPago)
      
      // Determinar status real
      let statusCalculado: 'PENDENTE' | 'PAGO' | 'VENCIDO' | 'PARCIAL' = fatura.status
      if (valorPago >= valorTotal) {
        statusCalculado = 'PAGO'
      } else if (valorPago > 0) {
        statusCalculado = 'PARCIAL'
      } else if (fatura.dataVencimento && new Date(fatura.dataVencimento) < new Date()) {
        statusCalculado = 'VENCIDO'
      }

      return {
        ...fatura,
        valor: valorTotal,
        valorOriginal: toNumber(fatura.valorOriginal),
        cambio: toNumber(fatura.cambio),
        valorParcela: toNumber(fatura.valorParcela),
        valorPago,
        valorRestante,
        status: statusCalculado,
        pagamentos: fatura.pagamentos.map(p => ({
          ...p,
          valor: toNumber(p.valor)
        })),
        // Flatten destinatários
        destinatarios: fatura.destinatarios.map(d => d.requerente)
      }
    })

    // Totais gerais
    const totais = faturasComCalculos.reduce((acc, f) => ({
      total: acc.total + f.valor,
      pago: acc.pago + f.valorPago,
      pendente: acc.pendente + (f.status === 'PENDENTE' || f.status === 'PARCIAL' ? f.valorRestante : 0),
      vencido: acc.vencido + (f.status === 'VENCIDO' ? f.valorRestante : 0)
    }), { total: 0, pago: 0, pendente: 0, vencido: 0 })

    return NextResponse.json({ faturas: faturasComCalculos, totais })

  } catch (error) {
    console.error('Erro ao buscar faturas:', error)
    return NextResponse.json(
      { error: 'Erro ao buscar faturas' },
      { status: 500 }
    )
  }
}

// ========================================
// POST - Criar nova fatura
// ========================================
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ processoId: string }> }
) {
  try {
    const { processoId } = await params
    const processoIdNum = parseInt(processoId)
    
    const body = await request.json()

    const {
      descricao,
      moeda = 'BRL',
      valorOriginal,
      cambio,
      valor,
      metodoPagamento,
      parcelas = 1,
      valorParcela,
      dataVencimento,
      observacoes,
      destinatarioIds
    } = body

    // Validações
    if (!descricao?.trim()) {
      return NextResponse.json(
        { error: 'Descrição é obrigatória' },
        { status: 400 }
      )
    }

    if (!valor || parseFloat(valor) <= 0) {
      return NextResponse.json(
        { error: 'Valor deve ser maior que zero' },
        { status: 400 }
      )
    }

    // Criar fatura
    const fatura = await prisma.fatura.create({
      data: {
        processoId: processoIdNum,
        descricao: descricao.trim(),
        moeda,
        valorOriginal: valorOriginal ? parseFloat(valorOriginal) : null,
        cambio: cambio ? parseFloat(cambio) : null,
        valor: parseFloat(valor),
        metodoPagamento: metodoPagamento || null,
        parcelas: parcelas || 1,
        valorParcela: valorParcela ? parseFloat(valorParcela) : null,
        dataVencimento: dataVencimento ? new Date(dataVencimento) : null,
        observacoes: observacoes || null,
        // Criar relacionamentos com destinatários
        destinatarios: destinatarioIds?.length > 0 ? {
          create: destinatarioIds.map((requerenteId: number) => ({
            requerenteId
          }))
        } : undefined
      },
      include: {
        destinatarios: {
          include: {
            requerente: {
              select: { id: true, nome: true }
            }
          }
        }
      }
    })

    return NextResponse.json(fatura, { status: 201 })

  } catch (error) {
    console.error('Erro ao criar fatura:', error)
    return NextResponse.json(
      { error: 'Erro ao criar fatura' },
      { status: 500 }
    )
  }
}