// POST /api/financeiro/cobrancas/[id]/pagamentos — registra Pagamento na COBRANÇA
// (nunca direto na Receita). Atualiza a parcela + cria EventoFinanceiro + atualiza o
// status da Cobrança. Tudo na base ÚNICA → reflete no Financeiro Geral imediatamente.
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verificarPermissao, extrairUsuarioComPermissoes } from '@/src/lib/verificar-permissao'
import { guardLegadoEscrita } from '@/lib/financeiro/legado-guard'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const erro = await verificarPermissao(req, 'financeiro.ver'); if (erro) return erro
  const bloq = guardLegadoEscrita(); if (bloq) return bloq // legado só-leitura após o corte
  const cobrancaId = Number((await params).id)
  const b = await req.json().catch(() => ({}))
  const parcelaId = Number(b.parcelaId)
  const valor = Number(b.valor)
  if (!parcelaId || !(valor > 0)) return NextResponse.json({ error: 'Informe parcela e valor > 0' }, { status: 400 })

  const cob = await prisma.cobranca.findUnique({ where: { id: cobrancaId }, select: { id: true, receitaId: true } })
  if (!cob) return NextResponse.json({ error: 'Cobrança não encontrada' }, { status: 404 })
  const parcela = await prisma.parcelaFinanceira.findFirst({ where: { id: parcelaId, cobrancaId }, select: { id: true, status: true } })
  if (!parcela) return NextResponse.json({ error: 'Parcela não pertence a esta cobrança' }, { status: 400 })
  if (parcela.status === 'RECEBIDA' || parcela.status === 'PAGA') return NextResponse.json({ error: 'Parcela já quitada' }, { status: 409 })
  const actorId = (await extrairUsuarioComPermissoes(req))?.userId ?? null

  await prisma.$transaction(async (tx) => {
    await tx.parcelaFinanceira.update({ where: { id: parcelaId }, data: {
      status: 'RECEBIDA', dataPagamento: b.data ? new Date(b.data) : new Date(),
      formaPagamento: b.formaPagamento ?? undefined, comprovanteUrl: b.comprovanteUrl ?? undefined, observacoes: b.observacoes ?? undefined,
    } })
    await tx.eventoFinanceiro.create({ data: { receitaId: cob.receitaId, cobrancaId, usuarioId: actorId, tipo: 'RECEBIMENTO', descricao: `Recebimento parcela ${parcelaId}`.slice(0, 300), valor, dados: { parcelaId } } })
    const abertas = await tx.parcelaFinanceira.count({ where: { cobrancaId, status: { in: ['PENDENTE'] } } })
    await tx.cobranca.update({ where: { id: cobrancaId }, data: { status: abertas === 0 ? 'QUITADA' : 'PARCIAL' } })
  })
  return NextResponse.json({ ok: true })
}
