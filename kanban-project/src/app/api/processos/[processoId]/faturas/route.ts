// src/app/api/processos/[processoId]/faturas/route.ts
// ✅ ATUALIZADO - Com câmbio na fatura e totais convertidos para BRL

import { prisma } from "@/lib/prisma"
import { NextRequest, NextResponse } from "next/server"
import { Decimal } from "@prisma/client/runtime/library"
import { gerarVencimentosParcelas } from "@/src/lib/diasUteis"
import { verificarPermissao } from '@/src/lib/verificar-permissao'

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
// HELPER: Converter valor para BRL usando câmbio
// ========================================
function converterParaBRL(valor: number, moeda: string, cambio: number | null): number {
  if (moeda === 'BRL') return valor
  if (!cambio || cambio <= 0) return valor
  return valor * cambio
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
          orderBy: { data: 'desc' },
          include: {
            destinatarios: {
              include: {
                requerente: {
                  select: { id: true, nome: true }
                }
              }
            }
          }
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
                complemento: true,
                bairro: true,
                cidade: true,
                estado: true,
                cep: true
              }
            }
          }
        },
        parcelasBoleto: {
          orderBy: { numero: 'asc' }
        }
      },
      orderBy: { createdAt: 'desc' }
    })

    // Calcular totais e status
    const hoje = new Date()
    hoje.setUTCHours(0, 0, 0, 0)

    const faturasComCalculos = faturas.map((fatura: any) => {
      const valorTotal = toNumber(fatura.valor)
      const cambioFatura = toNumber(fatura.cambio)

      // Valor pago via pagamentos normais (filtrar estornados)
      const valorPagoPagamentos = fatura.pagamentos
        .filter((pag: any) => !pag.estornado)
        .reduce(
          (sum: number, pag: any) => sum + toNumber(pag.valor),
          0
        )

      // Valor pago via parcelas de boleto
      const valorPagoParcelas = fatura.parcelasBoleto
        .filter((p: any) => p.pago)
        .reduce((sum: number, p: any) => sum + toNumber(p.valor), 0)

      const valorPago = valorPagoPagamentos + valorPagoParcelas
      const valorRestante = Math.max(0, valorTotal - valorPago)

      const valorTotalBRL = converterParaBRL(valorTotal, fatura.moeda, cambioFatura)
      const valorPagoBRL = converterParaBRL(valorPago, fatura.moeda, cambioFatura)
      const valorRestanteBRL = converterParaBRL(valorRestante, fatura.moeda, cambioFatura)

      let statusCalculado: 'PENDENTE' | 'PAGO' | 'VENCIDO' | 'PARCIAL' = fatura.status
      if (valorPago >= valorTotal) {
        statusCalculado = 'PAGO'
      } else if (valorPago > 0) {
        statusCalculado = 'PARCIAL'
      } else if (fatura.dataVencimento) {
        const vencimento = new Date(fatura.dataVencimento)
        vencimento.setUTCHours(0, 0, 0, 0)
        if (vencimento < hoje) {
          statusCalculado = 'VENCIDO'
        }
      }

      const parcelasProcessadas = fatura.parcelasBoleto.map((parcela: any) => ({
        ...parcela,
        valor: toNumber(parcela.valor)
      }))

      return {
        ...fatura,
        valor: valorTotal,
        valorOriginal: toNumber(fatura.valorOriginal),
        cambio: cambioFatura,
        valorParcela: toNumber(fatura.valorParcela),
        valorPago,
        valorRestante,
        valorTotalBRL,
        valorPagoBRL,
        valorRestanteBRL,
        status: statusCalculado,
        pagamentos: fatura.pagamentos.map((p: any) => ({
          ...p,
          valor: toNumber(p.valor),
          valorOriginal: p.valorOriginal ? toNumber(p.valorOriginal) : null,
          cambio: p.cambio ? toNumber(p.cambio) : null,
          destinatarios: p.destinatarios?.map((d: any) => d.requerente) || []
        })),
        destinatarios: fatura.destinatarios.map((d: any) => d.requerente),
        parcelasBoleto: parcelasProcessadas
      }
    })

    // ========================================
    // TOTAIS POR MOEDA
    // ========================================
    const totaisPorMoeda: Record<string, { total: number; pago: number; pendente: number; vencido: number }> = {}

    faturasComCalculos.forEach((f: any) => {
      if (!totaisPorMoeda[f.moeda]) {
        totaisPorMoeda[f.moeda] = { total: 0, pago: 0, pendente: 0, vencido: 0 }
      }

      const isBoleto = f.metodoPagamento === 'BOLETO'
      const temParcelas = f.parcelasBoleto && f.parcelasBoleto.length > 0

      let vencidoFatura = 0
      let pendenteFatura = 0

      if (isBoleto && temParcelas) {
        f.parcelasBoleto.forEach((p: any) => {
          if (p.pago) return
          pendenteFatura += p.valor
          const vencimento = new Date(p.dataVencimento)
          vencimento.setUTCHours(0, 0, 0, 0)
          if (vencimento < hoje) {
            vencidoFatura += p.valor
          }
        })
      } else {
        pendenteFatura = f.valorRestante
        if (f.status === 'VENCIDO') {
          vencidoFatura = f.valorRestante
        }
      }

      totaisPorMoeda[f.moeda].total += f.valor
      totaisPorMoeda[f.moeda].pago += f.valorPago
      totaisPorMoeda[f.moeda].pendente += pendenteFatura
      totaisPorMoeda[f.moeda].vencido += vencidoFatura
    })

    // ========================================
    // TOTAIS GERAIS CONVERTIDOS PARA BRL
    // ========================================
    const totaisGeralBRL = faturasComCalculos.reduce((acc: any, f: any) => {
      const cambio = f.cambio || 1
      const isBoleto = f.metodoPagamento === 'BOLETO'
      const temParcelas = f.parcelasBoleto && f.parcelasBoleto.length > 0

      let vencidoFatura = 0
      let pendenteFatura = 0

      if (isBoleto && temParcelas) {
        f.parcelasBoleto.forEach((p: any) => {
          if (p.pago) return
          pendenteFatura += p.valor
          const vencimento = new Date(p.dataVencimento)
          vencimento.setUTCHours(0, 0, 0, 0)
          if (vencimento < hoje) {
            vencidoFatura += p.valor
          }
        })
      } else {
        pendenteFatura = f.valorRestante
        if (f.status === 'VENCIDO') {
          vencidoFatura = f.valorRestante
        }
      }

      const totalBRL = converterParaBRL(f.valor, f.moeda, cambio)
      const pagoBRL = converterParaBRL(f.valorPago, f.moeda, cambio)
      const pendenteBRL = converterParaBRL(pendenteFatura, f.moeda, cambio)
      const vencidoBRL = converterParaBRL(vencidoFatura, f.moeda, cambio)

      return {
        total: acc.total + totalBRL,
        pago: acc.pago + pagoBRL,
        pendente: acc.pendente + pendenteBRL,
        vencido: acc.vencido + vencidoBRL
      }
    }, { total: 0, pago: 0, pendente: 0, vencido: 0 })

    return NextResponse.json({
      faturas: faturasComCalculos,
      totaisPorMoeda,
      totaisGeralBRL
    })

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
    const erro = await verificarPermissao(request, 'financeiro.fatura_criar')
    if (erro) return erro

    const { processoId } = await params
    const processoIdNum = parseInt(processoId)

    const body = await request.json()

    const {
      descricao,
      moeda = 'BRL',
      valor,
      cambio,
      metodoPagamento,
      parcelas = 1,
      dataVencimento,
      observacoes,
      destinatarioIds
    } = body

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
    const cambioNumerico = cambio ? parseFloat(cambio) : null
    const quantidadeParcelas = parcelas || 1
    const valorParcelaCalculado = valorNumerico / quantidadeParcelas
    const isBoleto = metodoPagamento === 'BOLETO'

    let parcelasParaCriar: { numero: number; valor: number; dataVencimento: Date }[] = []

    if (isBoleto && quantidadeParcelas > 0 && dataVencimento) {
      const dataVencimentoInicial = new Date(dataVencimento)
      const vencimentos = gerarVencimentosParcelas(dataVencimentoInicial, quantidadeParcelas)

      parcelasParaCriar = vencimentos.map((venc: Date, index: number) => ({
        numero: index + 1,
        valor: valorParcelaCalculado,
        dataVencimento: venc
      }))
    }

    const fatura = await prisma.fatura.create({
      data: {
        processoId: processoIdNum,
        descricao: descricao.trim(),
        moeda,
        valor: valorNumerico,
        cambio: cambioNumerico,
        metodoPagamento: metodoPagamento || null,
        parcelas: quantidadeParcelas,
        valorParcela: valorParcelaCalculado,
        dataVencimento: dataVencimento ? new Date(dataVencimento) : null,
        observacoes: observacoes || null,
        destinatarios: destinatarioIds?.length > 0 ? {
          create: destinatarioIds.map((requerenteId: number) => ({
            requerenteId
          }))
        } : undefined,
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