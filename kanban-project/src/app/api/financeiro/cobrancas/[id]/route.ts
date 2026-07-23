// PUT /api/financeiro/cobrancas/[id] — RECALCULA uma Cobrança em rascunho.
// Só recalcula se puder (status ABERTA e SEM pagamento) — nunca reescreve
// histórico financeiro de cobrança paga/congelada. Recalcula no backend
// (autoridade) e substitui as parcelas PENDENTES; preserva eventos/pagamentos.
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { Prisma } from '@prisma/client'
import { verificarPermissao } from '@/src/lib/verificar-permissao'
import { montarECalcular } from '@/lib/financeiro/charge-runtime'
import { podeRecalcular } from '@/lib/financeiro/charge-calculation-service'

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const erro = await verificarPermissao(req, 'financeiro.ver'); if (erro) return erro
  const id = Number((await params).id)
  const b = await req.json().catch(() => ({}))

  const cob = await prisma.cobranca.findUnique({
    where: { id },
    select: { id: true, receitaId: true, congeladaEm: true, status: true, _count: { select: { eventos: true } } },
  })
  if (!cob) return NextResponse.json({ error: 'Cobrança não encontrada' }, { status: 404 })

  const recebidos = await prisma.eventoFinanceiro.count({ where: { cobrancaId: id, tipo: 'RECEBIMENTO' } })
  if (!podeRecalcular({ status: cob.status, temPagamento: recebidos > 0, congeladaEm: cob.congeladaEm })) {
    return NextResponse.json({ error: 'Cobrança com pagamento/congelada não pode ser recalculada.', codigo: 'RECALCULO_BLOQUEADO' }, { status: 409 })
  }

  const out = await montarECalcular({
    receitaId: cob.receitaId,
    formaPagamentoId: b.formaPagamentoId ? Number(b.formaPagamentoId) : null,
    condicaoPagamentoId: b.condicaoPagamentoId ? Number(b.condicaoPagamentoId) : null,
    carteiraId: b.carteiraId ? Number(b.carteiraId) : null,
    contaBancariaId: b.contaBancariaId ? Number(b.contaBancariaId) : null,
    nParcelas: b.nParcelas != null ? Number(b.nParcelas) : null,
    bandeiraId: b.bandeiraId ? Number(b.bandeiraId) : null,
    entradaValor: b.entradaValor != null ? Number(b.entradaValor) : null,
    politicaTaxasEscolhida: b.politicaTaxasEscolhida ?? null,
    congelar: !!b.confirmar,
  })
  if ('erro' in out) return NextResponse.json({ error: out.erro }, { status: out.status })
  const { resultado: r, receita, condicao } = out
  if (!r.ok) return NextResponse.json({ error: r.erros[0]?.mensagem ?? 'Cobrança inválida', erros: r.erros }, { status: 422 })

  await prisma.$transaction(async (tx) => {
    await tx.parcelaFinanceira.deleteMany({ where: { cobrancaId: id, status: 'PENDENTE' } }) // preserva pagas (não há, pela guarda)
    for (const p of r.parcelas) {
      await tx.parcelaFinanceira.create({ data: {
        cobrancaId: id, receitaId: receita.id, numero: p.numero, vencimento: p.vencimento,
        valor: p.valor, entrada: p.entrada, valorTaxa: p.valorTaxa, valorLiquido: p.valorLiquido, status: 'PENDENTE',
      } })
    }
    await tx.cobranca.update({ where: { id }, data: {
      formaPagamentoId: b.formaPagamentoId ? Number(b.formaPagamentoId) : null,
      condicaoPagamentoId: condicao?.id ?? null,
      carteiraId: b.carteiraId ? Number(b.carteiraId) : null,
      taxaPagamentoId: r.taxaAplicada?.id ?? null,
      valorTotal: r.totalCobrado, condicaoVersao: condicao?.versao ?? null, condicaoCodigo: condicao?.codigo ?? null,
      politicaTaxas: r.politicaTaxas, valorBase: r.valorBase, valorTaxa: r.valorTaxa,
      valorRepassado: r.valorRepassado, valorAbsorvido: r.valorAbsorvido, valorLiquido: r.valorLiquido,
      moedaOrigem: r.cambio?.moedaOrigem ?? null, cotacao: r.cambio?.cotacao ?? null,
      cotacaoData: r.cambio?.data ?? null, cotacaoFonte: r.cambio?.fonte ?? null,
      congeladaEm: b.confirmar ? new Date() : null,
      memoriaCalculo: { snapshot: r.snapshot, memoria: r.memoria } as Prisma.InputJsonValue,
    } })
  })
  return NextResponse.json({ ok: true, memoria: r.memoria, parcelas: r.parcelas.length })
}
