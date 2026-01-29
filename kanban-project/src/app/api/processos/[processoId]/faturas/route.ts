// src/app/api/processos/[processoId]/faturas/route.ts
// ATUALIZADO - Com geração automática de parcelas para boletos

import { prisma } from "@/lib/prisma"
import { NextRequest, NextResponse } from "next/server"
import { Decimal } from "@prisma/client/runtime/library"
import { gerarVencimentosParcelas } from "@/src/lib/diasUteis"

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
        },
        // ✅ NOVO: Incluir parcelas do boleto
        parcelasBoleto: {
          orderBy: { numero: 'asc' }
        }
      },
      orderBy: { createdAt: 'desc' }
    })

    // Calcular totais e status
    const faturasComCalculos = faturas.map(fatura => {
      const valorTotal = toNumber(fatura.valor)
      // Valor pago via pagamentos normais
      const valorPagoPagamentos = fatura.pagamentos.reduce(
        (sum: number, pag: { valor: Decimal | number | string | null }) => sum + toNumber(pag.valor), 
        0
      )

      // Valor pago via parcelas de boleto
      const valorPagoParcelas = fatura.parcelasBoleto
        .filter(p => p.pago)
        .reduce((sum, p) => sum + toNumber(p.valor), 0)

      // Total pago = pagamentos + parcelas pagas
      const valorPago = valorPagoPagamentos + valorPagoParcelas
      const valorRestante = Math.max(0, valorTotal - valorPago)
      
      // Determinar status real
      let statusCalculado: 'PENDENTE' | 'PAGO' | 'VENCIDO' | 'PARCIAL' = fatura.status
      if (valorPago >= valorTotal) {
        statusCalculado = 'PAGO'
      } else if (valorPago > 0) {
        statusCalculado = 'PARCIAL'
      } else if (fatura.dataVencimento) {
        // Comparar apenas as datas (sem horário)
        const hoje = new Date()
        hoje.setUTCHours(0, 0, 0, 0)
        
        const vencimento = new Date(fatura.dataVencimento)
        vencimento.setUTCHours(0, 0, 0, 0)
        
        if (vencimento < hoje) {
          statusCalculado = 'VENCIDO'
        }
      }

      // ✅ NOVO: Processar parcelas do boleto
      const parcelasProcessadas = fatura.parcelasBoleto.map(parcela => ({
        ...parcela,
        valor: toNumber(parcela.valor)
      }))

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
        destinatarios: fatura.destinatarios.map(d => d.requerente),
        // ✅ NOVO: Parcelas do boleto
        parcelasBoleto: parcelasProcessadas
      }
    })

    // Totais gerais
    const hoje = new Date()
    hoje.setUTCHours(0, 0, 0, 0)

    const totais = faturasComCalculos.reduce((acc, f) => {
      const isBoleto = f.metodoPagamento === 'BOLETO'
      const temParcelas = f.parcelasBoleto && f.parcelasBoleto.length > 0

      let vencidoFatura = 0
      let pendenteFatura = 0

      if (isBoleto && temParcelas) {
        // Para boletos, calcular por parcela
        f.parcelasBoleto.forEach(p => {
          if (p.pago) return // já foi contado no valorPago
          
          // Toda parcela não paga é pendente
          pendenteFatura += p.valor
          
          // Se também está vencida, conta no vencido
          const vencimento = new Date(p.dataVencimento)
          vencimento.setUTCHours(0, 0, 0, 0)
          
          if (vencimento < hoje) {
            vencidoFatura += p.valor
          }
        })
      } else {
        // Para não-boletos, usar lógica original
        pendenteFatura = f.valorRestante
        if (f.status === 'VENCIDO') {
          vencidoFatura = f.valorRestante
        }
      }

      return {
        total: acc.total + f.valor,
        pago: acc.pago + f.valorPago,
        pendente: acc.pendente + pendenteFatura,
        vencido: acc.vencido + vencidoFatura
      }
    }, { total: 0, pago: 0, pendente: 0, vencido: 0 })

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

    const valorNumerico = parseFloat(valor)
    const quantidadeParcelas = parcelas || 1
    const valorParcelaCalculado = valorNumerico / quantidadeParcelas
    const isBoleto = metodoPagamento === 'BOLETO'

    // ✅ NOVO: Gerar datas de vencimento das parcelas para boletos
    let parcelasParaCriar: { numero: number; valor: number; dataVencimento: Date }[] = []
    
    if (isBoleto && quantidadeParcelas > 0 && dataVencimento) {
      const dataVencimentoInicial = new Date(dataVencimento)
      const vencimentos = gerarVencimentosParcelas(dataVencimentoInicial, quantidadeParcelas)
      
      parcelasParaCriar = vencimentos.map((venc, index) => ({
        numero: index + 1,
        valor: valorParcelaCalculado,
        dataVencimento: venc
      }))
    }

    // Criar fatura com parcelas
    const fatura = await prisma.fatura.create({
      data: {
        processoId: processoIdNum,
        descricao: descricao.trim(),
        moeda,
        valorOriginal: valorOriginal ? parseFloat(valorOriginal) : null,
        cambio: cambio ? parseFloat(cambio) : null,
        valor: valorNumerico,
        metodoPagamento: metodoPagamento || null,
        parcelas: quantidadeParcelas,
        valorParcela: valorParcelaCalculado,
        dataVencimento: dataVencimento ? new Date(dataVencimento) : null,
        observacoes: observacoes || null,
        // Criar relacionamentos com destinatários
        destinatarios: destinatarioIds?.length > 0 ? {
          create: destinatarioIds.map((requerenteId: number) => ({
            requerenteId
          }))
        } : undefined,
        // ✅ NOVO: Criar parcelas para boletos
        parcelasBoleto: parcelasParaCriar.length > 0 ? {
          create: parcelasParaCriar
        } : undefined
      },
      include: {
        destinatarios: {
          include: {
            requerente: {
              select: { id: true, nome: true }
            }
          }
        },
        parcelasBoleto: {
          orderBy: { numero: 'asc' }
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