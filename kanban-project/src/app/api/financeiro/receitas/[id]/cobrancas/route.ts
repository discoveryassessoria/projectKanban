// /api/financeiro/receitas/[id]/cobrancas — Cobranças de uma Receita (base ÚNICA).
//   GET  → lista as cobranças da receita (com resumo de parcelas/recebido)
//   POST → cria uma Cobrança consumindo config de Gerenciamento por ID; gera as
//          parcelas via gerarCronograma (mesma lógica oficial). Nunca altera a Receita.
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { Prisma } from '@prisma/client'
import { verificarPermissao, extrairUsuarioComPermissoes } from '@/src/lib/verificar-permissao'
import { montarECalcular } from '@/lib/financeiro/charge-runtime'

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const erro = await verificarPermissao(req, 'financeiro.ver'); if (erro) return erro
  const receitaId = Number((await params).id)
  const cobrancas = await prisma.cobranca.findMany({
    where: { receitaId }, orderBy: { criadoEm: 'desc' },
    include: { parcelas: { select: { id: true, numero: true, vencimento: true, valor: true, status: true } }, eventos: { select: { id: true, tipo: true, valor: true, createdAt: true } } },
  })
  return NextResponse.json({ cobrancas })
}

// POST — CONFIRMA uma Cobrança. Recalcula no backend (autoridade), persiste os
// valores resultantes + auditoria, gera as parcelas e CONGELA. Nunca confia no
// número enviado pelo cliente.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const erro = await verificarPermissao(req, 'financeiro.ver'); if (erro) return erro
  const receitaId = Number((await params).id)
  const b = await req.json().catch(() => ({}))

  const out = await montarECalcular({
    receitaId,
    formaPagamentoId: b.formaPagamentoId ? Number(b.formaPagamentoId) : null,
    condicaoPagamentoId: b.condicaoPagamentoId ? Number(b.condicaoPagamentoId) : null,
    carteiraId: b.carteiraId ? Number(b.carteiraId) : null,
    contaBancariaId: b.contaBancariaId ? Number(b.contaBancariaId) : null,
    nParcelas: b.nParcelas != null ? Number(b.nParcelas) : null,
    politicaTaxasEscolhida: b.politicaTaxasEscolhida ?? null,
    congelar: true,
  })
  if ('erro' in out) return NextResponse.json({ error: out.erro }, { status: out.status })
  const { resultado: r, receita, condicao } = out
  if (!r.ok) return NextResponse.json({ error: r.erros[0]?.mensagem ?? 'Cobrança inválida', erros: r.erros, codigo: r.erros[0]?.codigo }, { status: 422 })

  const actorId = (await extrairUsuarioComPermissoes(req))?.userId ?? null
  const cobranca = await prisma.$transaction(async (tx) => {
    const cob = await tx.cobranca.create({
      data: {
        receitaId: receita.id, processoId: receita.processoId,
        formaPagamentoId: b.formaPagamentoId ? Number(b.formaPagamentoId) : null,
        condicaoPagamentoId: condicao?.id ?? null,
        contaBancariaId: b.contaBancariaId ? Number(b.contaBancariaId) : null,
        carteiraId: b.carteiraId ? Number(b.carteiraId) : null,
        taxaPagamentoId: r.taxaAplicada?.id ?? null,
        gateway: b.gateway ? String(b.gateway).slice(0, 40) : null,
        moeda: receita.moeda as any, valorTotal: r.totalCobrado, status: 'ABERTA',
        condicaoVersao: condicao?.versao ?? null, condicaoCodigo: condicao?.codigo ?? null, criadoPorId: actorId,
        // runtime/auditoria (congelado na confirmação)
        politicaTaxas: r.politicaTaxas, valorBase: r.valorBase, valorTaxa: r.valorTaxa,
        valorRepassado: r.valorRepassado, valorAbsorvido: r.valorAbsorvido, valorLiquido: r.valorLiquido,
        moedaOrigem: r.cambio?.moedaOrigem ?? null, cotacao: r.cambio?.cotacao ?? null,
        cotacaoData: r.cambio?.data ?? null, cotacaoFonte: r.cambio?.fonte ?? null, congeladaEm: new Date(),
        memoriaCalculo: { snapshot: r.snapshot, memoria: r.memoria } as Prisma.InputJsonValue,
      },
    })
    for (const p of r.parcelas) {
      await tx.parcelaFinanceira.create({ data: {
        cobrancaId: cob.id, receitaId: receita.id, numero: p.numero, vencimento: p.vencimento,
        valor: p.valor, entrada: p.entrada, valorTaxa: p.valorTaxa, valorLiquido: p.valorLiquido, status: 'PENDENTE',
      } })
    }
    await tx.eventoFinanceiro.create({ data: { receitaId: receita.id, cobrancaId: cob.id, usuarioId: actorId, tipo: 'CRIACAO', descricao: `Cobrança criada: ${r.nParcelas} parcela(s), ${r.politicaTaxas}`.slice(0, 300), valor: r.totalCobrado } })
    return cob
  })
  return NextResponse.json({ cobranca, parcelas: r.parcelas.length, memoria: r.memoria })
}
