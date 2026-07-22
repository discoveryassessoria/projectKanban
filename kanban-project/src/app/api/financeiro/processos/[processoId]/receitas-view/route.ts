// GET /api/financeiro/processos/[processoId]/receitas-view
// View model AGREGADO da tela de Receitas do Processo (Fase→Requerente→Receita→
// Cobrança→Parcela). Uma composição, sem N+1: 1 query de receitas (com cobranças/
// parcelas/pessoa/serviço) + catálogos pequenos. Backend é a fonte da verdade;
// o agrupamento/totais vêm do view model PURO (receitas-processo-view.ts).
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verificarPermissao } from '@/src/lib/verificar-permissao'
import { montarReceitasView, type ReceitaRow, type Catalogos } from '@/lib/financeiro/receitas-processo-view'

export async function GET(req: NextRequest, { params }: { params: Promise<{ processoId: string }> }) {
  const erro = await verificarPermissao(req, 'financeiro.ver'); if (erro) return erro
  const processoId = Number((await params).processoId)
  if (!processoId) return NextResponse.json({ error: 'Processo inválido' }, { status: 400 })

  const [processo, receitas, fases, formas, condicoes, carteiras] = await Promise.all([
    prisma.processo.findUnique({ where: { id: processoId }, select: { id: true, nome: true } }),
    prisma.receita.findMany({
      where: { processoId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: {
        id: true, codigo: true, descricao: true, categoria: true, phaseKey: true, valor: true, moeda: true,
        status: true, cancelada: true, data1: true, estornoDeId: true, fxEstimado: true, fxData: true,
        pessoa: { select: { id: true, nome: true, sobrenome: true, createdAt: true } },
        tipoServico: { select: { nome: true } },
        cobrancas: {
          orderBy: { criadoEm: 'asc' },
          select: {
            id: true, status: true, valorTotal: true, formaPagamentoId: true, condicaoPagamentoId: true, carteiraId: true,
            parcelas: { select: { id: true, numero: true, vencimento: true, valor: true, status: true }, orderBy: { numero: 'asc' } },
            eventos: { select: { tipo: true, valor: true } },
          },
        },
      },
    }),
    prisma.catalogoFase.findMany({ select: { phaseKey: true, label: true } }),
    prisma.formaPagamentoCadastro.findMany({ select: { id: true, name: true } }),
    prisma.condicaoPagamento.findMany({ select: { id: true, name: true } }),
    prisma.carteiraRecebimento.findMany({ select: { id: true, nome: true } }),
  ])
  if (!processo) return NextResponse.json({ error: 'Processo não encontrado' }, { status: 404 })

  const cat: Catalogos = {
    fases: Object.fromEntries(fases.map((f) => [f.phaseKey, f.label])),
    formas: Object.fromEntries(formas.map((f) => [f.id, f.name])),
    condicoes: Object.fromEntries(condicoes.map((c) => [c.id, c.name])),
    carteiras: Object.fromEntries(carteiras.map((c) => [c.id, c.nome])),
  }

  const rows = JSON.parse(JSON.stringify(receitas)) as ReceitaRow[] // Decimals→string, Dates→ISO
  const view = montarReceitasView(rows, cat, Date.now())

  // cotação contextual: primeira receita em moeda estrangeira (nunca soma moedas)
  const estrangeira = receitas.find((r) => String(r.moeda) !== 'BRL')
  const cambio = estrangeira ? { moeda: String(estrangeira.moeda), cotacao: Number(estrangeira.fxEstimado ?? 0), data: estrangeira.fxData, estimado: true } : null

  return NextResponse.json({ processo: { id: processo.id, nome: processo.nome }, view, cambio })
}
