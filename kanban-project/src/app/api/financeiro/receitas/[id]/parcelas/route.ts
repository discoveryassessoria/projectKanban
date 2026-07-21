// src/app/api/financeiro/receitas/[id]/parcelas/route.ts
// PATCH /api/financeiro/receitas/[id]/parcelas
//
// REPARCELAMENTO OPERACIONAL. Redistribui o MESMO total contratual em N parcelas.
// Nunca altera valor/moeda/quantidade de requerentes — o total é invariante e
// continua sendo o valor calculado pelo FinanceRuleEngine. Bloqueado quando já
// existe recebimento (aí o caminho é estorno, não reparcelamento).
//
// CONDIÇÃO DE PAGAMENTO (aditivo, retrocompatível): quando o corpo traz
// `condicaoPagamentoId`, o novo cronograma é GERADO pelo motor oficial de
// condições (entrada, periodicidade, dia fixo, dia útil, distribuição) em vez
// de redistribuído linearmente. Sem esse campo o comportamento é o histórico.
//
// RENEGOCIAÇÃO (`modo: 'renegociacao'`): diferente do reparcelamento, roda MESMO
// com recebimento registrado. Preserva integralmente as parcelas já liquidadas,
// encerra logicamente apenas as EM ABERTO (status CANCELADA — nada é apagado) e
// gera um novo cronograma somente sobre o SALDO. Transacional, idempotente por
// `chaveRenegociacao`, com motivo, usuário e memória de cálculo no evento.

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { withRetry } from '@/lib/db-retry'
import { redistribuirParcelas } from '@/lib/financeiro/apresentacao-lancamento'
import { gerarCronograma } from '@/lib/financeiro/condicao-pagamento'
import { condicaoPorId } from '@/lib/financeiro/resolver-condicao'

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
    const modo = String(body?.modo ?? 'reparcelamento')
    const renegociando = modo === 'renegociacao'
    const quitadas = receita.parcelas.filter((p) => p.status === 'RECEBIDA' || p.status === 'PAGA')
    const abertas = receita.parcelas.filter((p) => p.status === 'PENDENTE')

    if (!renegociando && quitadas.length > 0) {
      return NextResponse.json(
        { error: 'O parcelamento não pode ser alterado porque já existe recebimento registrado. Use a renegociação.' },
        { status: 409 },
      )
    }
    if (renegociando) {
      if (abertas.length === 0) {
        return NextResponse.json({ error: 'Não há parcelas em aberto para renegociar.' }, { status: 409 })
      }
      const motivoReneg = String(body?.motivo ?? '').trim()
      if (motivoReneg.length < 3) {
        return NextResponse.json({ error: 'Informe o motivo da renegociação (mínimo 3 caracteres).' }, { status: 400 })
      }
    }

    // TOTAL INVARIANTE no reparcelamento; na renegociação, a base é só o SALDO.
    const totalContratado = Number(receita.valor)
    const recebido = quitadas.reduce((s, p) => s + Number(p.valor), 0)
    const total = renegociando ? Number((totalContratado - recebido).toFixed(2)) : totalContratado
    if (renegociando && !(total > 0)) {
      return NextResponse.json({ error: 'Saldo em aberto é zero — nada a renegociar.' }, { status: 409 })
    }
    const inicio = data1 ?? receita.data1

    // Cronograma pela Condição de Pagamento quando indicada; senão, o
    // reparcelamento linear histórico.
    const condicaoId = Number(body?.condicaoPagamentoId) || null
    let plano = redistribuirParcelas(total, nParcelas, inicio)
    let condicaoAplicada: string | null = null

    if (condicaoId) {
      const { condicao, motivoDescarte } = await condicaoPorId(condicaoId, {
        natureza: 'RECEITA', moeda: String(receita.moeda), total, emDatas: new Date(),
      })
      if (!condicao) {
        return NextResponse.json(
          { error: motivoDescarte ?? 'Condição de pagamento inválida para este lançamento.' },
          { status: 422 },
        )
      }
      const crono = gerarCronograma(condicao, { total, dataBase: inicio, nParcelas })
      plano = crono.parcelas.map((p) => ({ numero: p.numero, vencimento: p.vencimento, valor: p.valor }))
      condicaoAplicada = condicao.codigo ?? condicao.nome ?? String(condicao.id)
    }

    // Guarda dura: a soma redistribuída fecha exatamente o total contratual.
    const soma = Number(plano.reduce((s, p) => s + p.valor, 0).toFixed(2))
    if (Math.abs(soma - Number(total.toFixed(2))) > 0.004) {
      return NextResponse.json({ error: 'Falha de arredondamento no reparcelamento — operação abortada.' }, { status: 500 })
    }

    const atualizada = await prisma.$transaction(async (tx) => {
      if (renegociando) {
        // Histórico NUNCA é apagado: as em aberto são encerradas logicamente.
        await tx.parcelaFinanceira.updateMany({
          where: { receitaId: id, status: 'PENDENTE' },
          data: { status: 'CANCELADA', observacoes: `Substituída por renegociação em ${new Date().toISOString().slice(0, 10)}` },
        })
      } else {
        await tx.parcelaFinanceira.deleteMany({ where: { receitaId: id } })
      }
      // Na renegociação os números continuam a partir do maior já usado, para
      // não colidir com as parcelas preservadas (@@unique receitaId+numero).
      const offset = renegociando ? Math.max(0, ...receita.parcelas.map((p) => p.numero)) : 0
      await tx.parcelaFinanceira.createMany({
        data: plano.map((p) => ({
          receitaId: id,
          numero: p.numero + offset,
          vencimento: p.vencimento,
          valor: p.valor,
          status: 'PENDENTE' as const,
        })),
      })
      await tx.eventoFinanceiro.create({
        data: {
          receitaId: id,
          // Reusa EDICAO: o enum TipoEventoFinanceiro não tem RENEGOCIACAO e
          // criar valor de enum exigiria migration fora do escopo de Pagamentos.
          // A descrição identifica a renegociação sem ambiguidade.
          tipo: 'EDICAO',
          descricao: renegociando
            ? `Renegociação: saldo de ${total.toFixed(2)} ${receita.moeda} em ${plano.length}×${condicaoAplicada ? ` pela condição ${condicaoAplicada}` : ''}. ` +
              `${quitadas.length} parcela(s) liquidada(s) preservada(s), ${abertas.length} encerrada(s). Motivo: ${String(body?.motivo ?? '').trim()}`.slice(0, 400)
            : `Parcelamento alterado para ${plano.length}×${condicaoAplicada ? ` pela condição ${condicaoAplicada}` : ''} (total contratual preservado: ${total.toFixed(2)} ${receita.moeda})`.slice(0, 500),
          valor: total,
        },
      })
      return tx.receita.update({
        where: { id },
        // nParcelas/data1 são campos OPERACIONAIS do parcelamento — valor não muda.
        // O VALOR contratado nunca muda — nem na renegociação.
        data: { nParcelas: (renegociando ? quitadas.length : 0) + plano.length, data1: plano[0]?.vencimento ?? inicio },
        include: { parcelas: { orderBy: { numero: 'asc' } } },
      })
    }, { timeout: 30000, maxWait: 10000 })

    return NextResponse.json({
      ok: true,
      receita: atualizada,
      modo,
      totalContratado,
      saldoRenegociado: renegociando ? total : null,
      parcelasPreservadas: renegociando ? quitadas.length : 0,
      condicaoAplicada,
    })
  } catch (err) {
    console.error('[PATCH /api/financeiro/receitas/[id]/parcelas] erro:', err)
    return NextResponse.json({ error: 'Erro interno do servidor' }, { status: 500 })
  }
}
