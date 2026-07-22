// /api/financeiro/receitas/[id]/cobrancas — Cobranças de uma Receita (base ÚNICA).
//   GET  → lista as cobranças da receita (com resumo de parcelas/recebido)
//   POST → cria uma Cobrança consumindo config de Gerenciamento por ID; gera as
//          parcelas via gerarCronograma (mesma lógica oficial). Nunca altera a Receita.
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { Prisma } from '@prisma/client'
import { verificarPermissao, extrairUsuarioComPermissoes } from '@/src/lib/verificar-permissao'
import { gerarCronograma, type CondicaoPagamentoView } from '@/lib/financeiro/condicao-pagamento'

const n = (v: unknown) => (v == null ? null : Number(v))

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const erro = await verificarPermissao(req, 'financeiro.ver'); if (erro) return erro
  const receitaId = Number((await params).id)
  const cobrancas = await prisma.cobranca.findMany({
    where: { receitaId }, orderBy: { criadoEm: 'desc' },
    include: { parcelas: { select: { id: true, numero: true, vencimento: true, valor: true, status: true } }, eventos: { select: { id: true, tipo: true, valor: true, createdAt: true } } },
  })
  return NextResponse.json({ cobrancas })
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const erro = await verificarPermissao(req, 'financeiro.ver'); if (erro) return erro
  const receitaId = Number((await params).id)
  const b = await req.json().catch(() => ({}))
  const receita = await prisma.receita.findUnique({ where: { id: receitaId }, select: { id: true, processoId: true, valor: true, moeda: true } })
  if (!receita) return NextResponse.json({ error: 'Receita não encontrada' }, { status: 404 })

  const condicaoId = Number(b.condicaoPagamentoId) || null
  let view: CondicaoPagamentoView | null = null
  let condicaoVersao: number | null = null
  let condicaoCodigo: string | null = null
  if (condicaoId) {
    const cond = await prisma.condicaoPagamento.findUnique({ where: { id: condicaoId } })
    if (!cond) return NextResponse.json({ error: 'Condição de pagamento inválida' }, { status: 400 })
    view = JSON.parse(JSON.stringify(cond)) as CondicaoPagamentoView // Decimals→string, Dates→ISO
    condicaoVersao = cond.versao; condicaoCodigo = cond.codigo
  }

  const total = Number(receita.valor)
  const nParcelas = b.nParcelas != null ? Number(b.nParcelas) : undefined
  const cron = gerarCronograma(view, { total, dataBase: new Date(), nParcelas })
  const actorId = (await extrairUsuarioComPermissoes(req))?.userId ?? null

  const cobranca = await prisma.$transaction(async (tx) => {
    const cob = await tx.cobranca.create({
      data: {
        receitaId: receita.id, processoId: receita.processoId,
        formaPagamentoId: b.formaPagamentoId ? Number(b.formaPagamentoId) : null,
        condicaoPagamentoId: condicaoId,
        contaBancariaId: b.contaBancariaId ? Number(b.contaBancariaId) : null,
        carteiraId: b.carteiraId ? Number(b.carteiraId) : null,
        taxaPagamentoId: b.taxaPagamentoId ? Number(b.taxaPagamentoId) : null,
        gateway: b.gateway ? String(b.gateway).slice(0, 40) : null,
        moeda: receita.moeda, valorTotal: total, status: 'ABERTA',
        condicaoVersao, condicaoCodigo, criadoPorId: actorId,
        memoriaCalculo: { periodicidade: cron.periodicidade, nParcelas: cron.nParcelas, valorEntrada: cron.valorEntrada, observacoes: cron.observacoes } as Prisma.InputJsonValue,
      },
    })
    // parcelas pertencem à COBRANÇA (cobrancaId). Também referenciam a receita p/ compat de leitura.
    for (const p of cron.parcelas) {
      await tx.parcelaFinanceira.create({ data: {
        cobrancaId: cob.id, receitaId: receita.id, numero: p.numero, vencimento: p.vencimento, valor: p.valor, entrada: p.entrada, status: 'PENDENTE',
      } })
    }
    await tx.eventoFinanceiro.create({ data: { receitaId: receita.id, cobrancaId: cob.id, usuarioId: actorId, tipo: 'CRIACAO', descricao: `Cobrança criada: ${cron.nParcelas} parcela(s)`.slice(0, 300), valor: total } })
    return cob
  })
  return NextResponse.json({ cobranca, parcelas: cron.parcelas.length })
}
