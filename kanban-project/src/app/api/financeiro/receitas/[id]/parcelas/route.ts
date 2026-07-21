// src/app/api/financeiro/receitas/[id]/parcelas/route.ts
// PATCH /api/financeiro/receitas/[id]/parcelas
//
// REPARCELAMENTO OPERACIONAL. Redistribui o MESMO total contratual em N parcelas.
// Nunca altera valor/moeda/quantidade de requerentes — o total é invariante e
// continua sendo o valor calculado pelo FinanceRuleEngine. Bloqueado quando já
// existe recebimento (aí o caminho é estorno, não reparcelamento).

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { withRetry } from '@/lib/db-retry'
import { redistribuirParcelas } from '@/lib/financeiro/apresentacao-lancamento'

type RouteContext = { params: Promise<{ id: string }> }

export async function PATCH(req: NextRequest, ctx: RouteContext) {
  try {
    const { id: idStr } = await ctx.params
    const id = Number(idStr)
    if (!id || isNaN(id)) return NextResponse.json({ error: 'id inválido' }, { status: 400 })

    const body = await req.json().catch(() => ({}))
    const nParcelas = Number(body?.nParcelas)
    if (!Number.isInteger(nParcelas) || nParcelas < 1 || nParcelas > 120) {
      return NextResponse.json({ error: 'nParcelas deve ser inteiro entre 1 e 120' }, { status: 400 })
    }
    const data1 = body?.data1 ? new Date(body.data1) : null
    if (data1 && isNaN(data1.getTime())) {
      return NextResponse.json({ error: 'data1 inválida' }, { status: 400 })
    }

    const receita = await withRetry(() =>
      prisma.receita.findUnique({
        where: { id },
        include: { parcelas: { orderBy: { numero: 'asc' } } },
      }),
    )
    if (!receita) return NextResponse.json({ error: 'Receita não encontrada' }, { status: 404 })
    if (receita.cancelada || receita.canceladoEm) {
      return NextResponse.json({ error: 'Lançamento cancelado — parcelamento não pode ser alterado.' }, { status: 409 })
    }
    if (receita.estornadoEm) {
      return NextResponse.json({ error: 'Lançamento estornado — parcelamento não pode ser alterado.' }, { status: 409 })
    }
    if (receita.parcelas.some((p) => p.status === 'RECEBIDA' || p.status === 'PAGA')) {
      return NextResponse.json(
        { error: 'O parcelamento não pode ser alterado porque já existe recebimento registrado. Estorne o recebimento primeiro.' },
        { status: 409 },
      )
    }

    // TOTAL INVARIANTE: sempre o valor do lançamento (motor), nunca a soma editada.
    const total = Number(receita.valor)
    const inicio = data1 ?? receita.data1
    const plano = redistribuirParcelas(total, nParcelas, inicio)

    // Guarda dura: a soma redistribuída fecha exatamente o total contratual.
    const soma = Number(plano.reduce((s, p) => s + p.valor, 0).toFixed(2))
    if (Math.abs(soma - Number(total.toFixed(2))) > 0.004) {
      return NextResponse.json({ error: 'Falha de arredondamento no reparcelamento — operação abortada.' }, { status: 500 })
    }

    const atualizada = await prisma.$transaction(async (tx) => {
      await tx.parcelaFinanceira.deleteMany({ where: { receitaId: id } })
      await tx.parcelaFinanceira.createMany({
        data: plano.map((p) => ({
          receitaId: id,
          numero: p.numero,
          vencimento: p.vencimento,
          valor: p.valor,
          status: 'PENDENTE' as const,
        })),
      })
      await tx.eventoFinanceiro.create({
        data: {
          receitaId: id,
          tipo: 'EDICAO',
          descricao: `Parcelamento alterado para ${nParcelas}× (total contratual preservado: ${total.toFixed(2)} ${receita.moeda})`.slice(0, 500),
          valor: total,
        },
      })
      return tx.receita.update({
        where: { id },
        // nParcelas/data1 são campos OPERACIONAIS do parcelamento — valor não muda.
        data: { nParcelas, data1: inicio },
        include: { parcelas: { orderBy: { numero: 'asc' } } },
      })
    }, { timeout: 30000, maxWait: 10000 })

    return NextResponse.json({ ok: true, receita: atualizada, totalPreservado: total })
  } catch (err) {
    console.error('[PATCH /api/financeiro/receitas/[id]/parcelas] erro:', err)
    return NextResponse.json({ error: 'Erro interno do servidor' }, { status: 500 })
  }
}
