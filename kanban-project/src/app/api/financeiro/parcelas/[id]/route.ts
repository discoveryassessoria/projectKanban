// src/app/api/financeiro/parcelas/[id]/route.ts
// PATCH /api/financeiro/parcelas/[id]
//
// Campos OPERACIONAIS da parcela: vencimento, forma de pagamento, banco,
// observações e comprovante. O VALOR da parcela nunca é editável por aqui —
// ele é fração do total calculado pelo motor; para mudar a divisão use o
// reparcelamento (PATCH /api/financeiro/receitas/[id]/parcelas).

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { withRetry } from '@/lib/db-retry'

type RouteContext = { params: Promise<{ id: string }> }

// espelha o enum FormaPagamento do schema
const FORMAS = ['PIX', 'CARTAO_CREDITO', 'CARTAO_DEBITO', 'BOLETO', 'TRANSFERENCIA', 'DINHEIRO', 'CHEQUE', 'OUTRO']

export async function PATCH(req: NextRequest, ctx: RouteContext) {
  try {
    const { id: idStr } = await ctx.params
    const id = Number(idStr)
    if (!id || isNaN(id)) return NextResponse.json({ error: 'id inválido' }, { status: 400 })

    const body = await req.json().catch(() => ({}))

    // Rejeita explicitamente tentativa de editar o valor calculado.
    if (body?.valor !== undefined) {
      return NextResponse.json(
        { error: 'O valor da parcela é definido automaticamente pelo FinanceRuleEngine. Use o reparcelamento para redistribuir o mesmo total.' },
        { status: 422 },
      )
    }

    const parcela = await withRetry(() =>
      prisma.parcelaFinanceira.findUnique({
        where: { id },
        select: {
          id: true, numero: true, status: true, receitaId: true, custoId: true,
          receita: { select: { id: true, cancelada: true, canceladoEm: true, estornadoEm: true } },
        },
      }),
    )
    if (!parcela) return NextResponse.json({ error: 'Parcela não encontrada' }, { status: 404 })
    if (parcela.receita && (parcela.receita.cancelada || parcela.receita.canceladoEm)) {
      return NextResponse.json({ error: 'Lançamento cancelado — parcela não pode ser alterada.' }, { status: 409 })
    }

    const data: Record<string, unknown> = {}
    const alterados: string[] = []

    if (body?.vencimento !== undefined) {
      if (parcela.status !== 'PENDENTE') {
        return NextResponse.json({ error: 'Só parcelas em aberto podem ter o vencimento alterado.' }, { status: 409 })
      }
      const v = new Date(body.vencimento)
      if (isNaN(v.getTime())) return NextResponse.json({ error: 'vencimento inválido' }, { status: 400 })
      data.vencimento = v
      alterados.push('vencimento')
    }
    if (body?.formaPagamento !== undefined) {
      const f = body.formaPagamento === null ? null : String(body.formaPagamento)
      if (f !== null && !FORMAS.includes(f)) {
        return NextResponse.json({ error: `formaPagamento inválida (use: ${FORMAS.join(', ')})` }, { status: 400 })
      }
      data.formaPagamento = f
      alterados.push('forma de pagamento')
    }
    if (body?.banco !== undefined) {
      data.banco = body.banco ? String(body.banco).slice(0, 100) : null
      alterados.push('banco')
    }
    if (body?.observacoes !== undefined) {
      data.observacoes = body.observacoes ? String(body.observacoes) : null
      alterados.push('observações')
    }
    if (body?.comprovanteUrl !== undefined) {
      data.comprovanteUrl = body.comprovanteUrl ? String(body.comprovanteUrl) : null
      data.comprovanteNome = body.comprovanteNome ? String(body.comprovanteNome).slice(0, 200) : null
      alterados.push('comprovante')
    }

    if (alterados.length === 0) {
      return NextResponse.json({ error: 'Nenhum campo operacional enviado.' }, { status: 400 })
    }

    const [atualizada] = await prisma.$transaction([
      prisma.parcelaFinanceira.update({ where: { id }, data }),
      prisma.eventoFinanceiro.create({
        data: {
          receitaId: parcela.receitaId,
          custoId: parcela.custoId,
          tipo: 'EDICAO',
          descricao: `Parcela ${parcela.numero}: ${alterados.join(', ')} atualizado(s)`.slice(0, 500),
        },
      }),
    ])

    return NextResponse.json({ ok: true, parcela: atualizada })
  } catch (err) {
    console.error('[PATCH /api/financeiro/parcelas/[id]] erro:', err)
    return NextResponse.json({ error: 'Erro interno do servidor' }, { status: 500 })
  }
}
