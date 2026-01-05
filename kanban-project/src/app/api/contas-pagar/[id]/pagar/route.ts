// CRIAR EM: src/app/api/contas-pagar/[id]/pagar/route.ts
import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

// POST - Registrar pagamento
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: idParam } = await params
    const id = parseInt(idParam)
    const body = await request.json()

    // Buscar conta
    const conta = await prisma.contaPagar.findUnique({
      where: { id }
    })

    if (!conta) {
      return NextResponse.json(
        { error: "Conta não encontrada" },
        { status: 404 }
      )
    }

    const valorPago = parseFloat(body.valorPago)
    const dataPagamento = body.dataPagamento ? new Date(body.dataPagamento) : new Date()
    const formaPagamento = body.formaPagamento
    const contaBancariaId = body.contaBancariaId ? parseInt(body.contaBancariaId) : null

    // Atualizar conta
    const contaAtualizada = await prisma.contaPagar.update({
      where: { id },
      data: {
        valorPago,
        dataPagamento,
        formaPagamento,
        contaBancariaId,
        status: "PAGO",
        juros: body.juros ? parseFloat(body.juros) : undefined,
        multa: body.multa ? parseFloat(body.multa) : undefined,
        desconto: body.desconto ? parseFloat(body.desconto) : undefined,
      }
    })

    // Criar transação no fluxo de caixa (se tiver conta bancária)
    if (contaBancariaId) {
      await prisma.transacao.create({
        data: {
          tipo: "SAIDA",
          descricao: `Pagamento: ${conta.descricao}`,
          valor: valorPago,
          data: dataPagamento,
          contaBancariaId,
          categoriaId: conta.categoriaId,
          contaPagarId: id,
          processoId: conta.processoId,
        }
      })

      // Atualizar saldo da conta bancária
      await prisma.contaBancaria.update({
        where: { id: contaBancariaId },
        data: {
          saldoAtual: {
            decrement: valorPago
          }
        }
      })
    }

    return NextResponse.json({
      ...contaAtualizada,
      valor: contaAtualizada.valor.toNumber(),
      valorPago: contaAtualizada.valorPago?.toNumber() || null,
    })
  } catch (error) {
    console.error("Erro ao registrar pagamento:", error)
    return NextResponse.json(
      { error: "Erro ao registrar pagamento" },
      { status: 500 }
    )
  }
}