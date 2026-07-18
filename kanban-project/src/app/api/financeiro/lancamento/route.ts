// §4 — GET /api/financeiro/lancamento?tipo=receita|custo&id=123
// Detalhe CANÔNICO compartilhado do lançamento (Receita/Custo): congelamento,
// rastreabilidade, origem, cancelamento, estorno e vínculo inverso.
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const tipo = searchParams.get('tipo')
    const id = Number(searchParams.get('id'))
    if ((tipo !== 'receita' && tipo !== 'custo') || !Number.isInteger(id)) {
      return NextResponse.json({ error: 'Parâmetros inválidos (tipo=receita|custo & id)' }, { status: 400 })
    }

    const comum = {
      id: true, codigo: true, descricao: true, moeda: true, valor: true, status: true, processoId: true, phaseKey: true,
      origem: true, origemLancamento: true, naturezaLancamento: true, naturezaPreco: true, eventoOperacionalId: true,
      pricingRuleId: true, configFinanceiraId: true, regraFinanceiraId: true, valorUnitario: true, quantidade: true,
      valorTotalCongelado: true, modoCalculoAplicado: true, contextoAplicado: true, dataReferencia: true, dataCompetencia: true,
      chaveIdempotencia: true, canceladoEm: true, canceladoMotivo: true, canceladoPorId: true, canceladoEventoRef: true,
      estornadoEm: true, estornoMotivo: true, estornoDeId: true, createdAt: true, updatedAt: true,
      processo: { select: { id: true, nome: true } },
      parcelas: { select: { id: true, numero: true, valor: true, vencimento: true, status: true, dataPagamento: true }, orderBy: { numero: 'asc' as const } },
    }

    const row = tipo === 'receita'
      ? await prisma.receita.findUnique({ where: { id }, select: { ...comum, personId: true, documentoId: true } })
      : await prisma.custo.findUnique({ where: { id }, select: { ...comum, fornecedor: true, tipo: true } })
    if (!row) return NextResponse.json({ error: 'Lançamento não encontrado' }, { status: 404 })

    // inverso vinculado (se este foi estornado) e/ou config nome
    const [inverso, config] = await Promise.all([
      tipo === 'receita' ? prisma.receita.findFirst({ where: { estornoDeId: id }, select: { id: true, codigo: true } })
        : prisma.custo.findFirst({ where: { estornoDeId: id }, select: { id: true, codigo: true } }),
      row.configFinanceiraId ? prisma.produtoFinanceiro.findUnique({ where: { id: row.configFinanceiraId }, select: { nome: true, naturezaFin: true } }) : null,
    ])

    return NextResponse.json({ tipo, lancamento: row, movimentoInverso: inverso, configuracao: config })
  } catch (e) {
    console.error('GET financeiro/lancamento', e)
    return NextResponse.json({ error: 'Erro ao carregar lançamento' }, { status: 500 })
  }
}
