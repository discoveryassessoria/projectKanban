// /api/financeiro/receitas/[id]/cobrancas — Cobranças de uma Receita (base ÚNICA).
//   GET  → lista as cobranças da receita (com resumo de parcelas/recebido)
//   POST → cria uma Cobrança consumindo config de Gerenciamento por ID; gera as
//          parcelas via gerarCronograma (mesma lógica oficial). Nunca altera a Receita.
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { Prisma } from '@prisma/client'
import { verificarPermissao, extrairUsuarioComPermissoes } from '@/src/lib/verificar-permissao'
import { temPermissao } from '@/src/lib/permissoes'
import { montarECalcular } from '@/lib/financeiro/charge-runtime'
import { espelharReceitaComoObrigacao } from '@/lib/financeiro/dual-write'
import { guardLegadoEscrita } from '@/lib/financeiro/legado-guard'

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
  const bloq = guardLegadoEscrita(); if (bloq) return bloq // legado só-leitura após o corte
  const receitaId = Number((await params).id)
  const b = await req.json().catch(() => ({}))

  const usuario = await extrairUsuarioComPermissoes(req)
  const actorId = usuario?.userId ?? null
  // Cotação manual só para admin ou quem edita valores financeiros.
  const autorizadoManual = !!usuario && (usuario.tipo === 'admin' || temPermissao(usuario.permissoes, 'financeiro.custos_editar'))

  // ── IDEMPOTÊNCIA: mesma chave nunca gera duas cobranças (retry seguro). ──
  const idempotencyKey = b.idempotencyKey ? String(b.idempotencyKey).slice(0, 80) : null
  if (idempotencyKey) {
    const existente = await prisma.cobranca.findUnique({ where: { idempotencyKey } })
    if (existente) {
      const nParc = await prisma.parcelaFinanceira.count({ where: { cobrancaId: existente.id } })
      return NextResponse.json({ cobranca: existente, parcelas: nParc, idempotente: true })
    }
  }

  const out = await montarECalcular({
    receitaId,
    formaPagamentoId: b.formaPagamentoId ? Number(b.formaPagamentoId) : null,
    condicaoPagamentoId: b.condicaoPagamentoId ? Number(b.condicaoPagamentoId) : null,
    carteiraId: b.carteiraId ? Number(b.carteiraId) : null,
    contaBancariaId: b.contaBancariaId ? Number(b.contaBancariaId) : null,
    nParcelas: b.nParcelas != null ? Number(b.nParcelas) : null,
    bandeiraId: b.bandeiraId ? Number(b.bandeiraId) : null,
    entradaValor: b.entradaValor != null ? Number(b.entradaValor) : null,
    politicaTaxasEscolhida: b.politicaTaxasEscolhida ?? null,
    moedaRecebimento: b.moedaRecebimento ?? null,
    cotacaoManual: b.cotacaoManual != null ? Number(b.cotacaoManual) : null,
    autorizadoManual,
    fonteCotacao: b.fonteCotacao ?? null,
    dataCotacao: b.dataCotacao ?? null,
    justificativaCotacaoManual: b.justificativaCotacaoManual ?? null,
    usuarioId: actorId,
    congelar: true,
  })
  if ('erro' in out) return NextResponse.json({ error: out.erro }, { status: out.status })
  const { resultado: r, receita, condicao, cambio } = out
  if (!r.ok) return NextResponse.json({ error: r.erros[0]?.mensagem ?? 'Cobrança inválida', erros: r.erros, codigo: r.erros[0]?.codigo }, { status: 422 })

  // Snapshot cambial COMPLETO congelado (também no JSON memoriaCalculo).
  const snapshotCambial = {
    moedaOrigem: cambio.moedaOrigem, moedaDestino: cambio.moedaDestino, cotacao: cambio.cotacao,
    direcao: cambio.direcao, tipo: cambio.tipo, estado: cambio.estado, fonte: cambio.fonte,
    data: cambio.data, cotacaoId: cambio.cotacaoId, usuarioId: cambio.usuarioId,
    justificativa: cambio.justificativa, precisao: 6, congeladoEm: new Date().toISOString(),
  }

  let cobranca
  try {
    cobranca = await prisma.$transaction(async (tx) => {
      const cob = await tx.cobranca.create({
        data: {
          receitaId: receita.id, processoId: receita.processoId,
          formaPagamentoId: b.formaPagamentoId ? Number(b.formaPagamentoId) : null,
          condicaoPagamentoId: condicao?.id ?? null,
          contaBancariaId: b.contaBancariaId ? Number(b.contaBancariaId) : null,
          carteiraId: b.carteiraId ? Number(b.carteiraId) : null,
          taxaPagamentoId: r.taxaAplicada?.id ?? null,
          bandeiraId: b.bandeiraId ? Number(b.bandeiraId) : null,
          gateway: b.gateway ? String(b.gateway).slice(0, 40) : null,
          moeda: receita.moeda as any, valorTotal: r.totalCobrado, status: 'ABERTA',
          condicaoVersao: condicao?.versao ?? null, condicaoCodigo: condicao?.codigo ?? null, criadoPorId: actorId,
          // runtime/auditoria (congelado na confirmação)
          politicaTaxas: r.politicaTaxas, valorBase: r.valorBase, valorTaxa: r.valorTaxa,
          valorRepassado: r.valorRepassado, valorAbsorvido: r.valorAbsorvido, valorLiquido: r.valorLiquido,
          // snapshot cambial completo
          moedaOrigem: cambio.moedaOrigem, moedaDestino: cambio.moedaDestino,
          cotacao: cambio.estado === 'MESMA' ? null : cambio.cotacao, cotacaoData: cambio.data,
          cotacaoFonte: cambio.fonte, cotacaoTipo: cambio.tipo, cotacaoId: cambio.cotacaoId,
          cotacaoManualPorId: cambio.tipo === 'MANUAL' ? cambio.usuarioId : null,
          cotacaoJustificativa: cambio.justificativa, congeladaEm: new Date(),
          idempotencyKey,
          memoriaCalculo: { snapshot: r.snapshot, cambio: snapshotCambial, memoria: r.memoria } as Prisma.InputJsonValue,
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
  } catch (e) {
    // Corrida de idempotência: a chave única barrou o segundo insert — devolve a
    // cobrança já criada (retry seguro, sem duplicar parcelas/snapshot).
    if (idempotencyKey && e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      const existente = await prisma.cobranca.findUnique({ where: { idempotencyKey } })
      if (existente) {
        const nParc = await prisma.parcelaFinanceira.count({ where: { cobrancaId: existente.id } })
        return NextResponse.json({ cobranca: existente, parcelas: nParc, idempotente: true })
      }
    }
    throw e
  }
  // Escrita dupla (Motor V3) — best-effort, no-op se a flag estiver desligada.
  await espelharReceitaComoObrigacao(
    { id: receita.id, codigo: (receita as any).codigo ?? null, valor: receita.valor, moeda: receita.moeda, processoId: receita.processoId },
    { cobrancaId: cobranca.id, criadoPorId: actorId },
  )

  return NextResponse.json({ cobranca, parcelas: r.parcelas.length, memoria: r.memoria })
}
