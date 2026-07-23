// src/app/api/gerenciamento/taxas-pagamento/formas/route.ts
// ============================================================================
// LISTAGEM AGREGADA por FORMA DE PAGAMENTO — uma linha por Forma (Cartão de
// Crédito, Débito, PIX, Boleto, Transferência, Dinheiro, Wise). Bandeira,
// adquirente e parcelas ficam DENTRO da configuração (rota /formas/[id]).
// Camada de leitura: o banco continua normalizado (uma taxa por forma×bandeira).
// ============================================================================
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verificarPermissao } from '@/src/lib/verificar-permissao'
import { INCLUDE_PARCELAMENTO } from '@/lib/financeiro/taxa-parcelamento'
import { agruparTaxasPorForma } from '@/lib/financeiro/taxa-identidade'

export async function GET(request: NextRequest) {
  try {
    const erro = await verificarPermissao(request, 'usuarios.gerenciar')
    if (erro) return erro

    const [taxas, formas, adquirentes, bandeiras] = await Promise.all([
      prisma.taxaPagamento.findMany({ include: { ...INCLUDE_PARCELAMENTO } }),
      prisma.formaPagamentoCadastro.findMany({ where: { ativo: true }, orderBy: [{ ordem: 'asc' }, { name: 'asc' }], select: { id: true, name: true, code: true, type: true, ativo: true } }),
      prisma.adquirente.findMany({ where: { ativo: true }, select: { id: true, nome: true } }),
      prisma.bandeira.findMany({ where: { ativo: true }, select: { id: true, nome: true } }),
    ])
    const nomeAdq = new Map(adquirentes.map((a) => [a.id, a.nome]))
    const nomeBand = new Map(bandeiras.map((b) => [b.id, b.nome]))

    const formasAgrupadas = agruparTaxasPorForma(
      taxas.map((t) => ({
        id: t.id, formasAplicaveis: t.formasAplicaveis, formaPagamentoId: t.formaPagamentoId,
        adquirenteId: t.adquirenteId, bandeiraId: t.bandeiraId, finalidade: t.finalidade,
        feePercent: t.feePercent != null ? Number(t.feePercent) : null, fixedFee: t.fixedFee != null ? Number(t.fixedFee) : null,
        ativo: t.ativo, vigenciaInicio: t.vigenciaInicio, vigenciaFim: t.vigenciaFim, atualizadoEm: t.atualizadoEm,
        parcelamento: (t.parcelamento ?? []).map((l) => ({ parcelasDe: l.parcelasDe, parcelasAte: l.parcelasAte, feePercent: l.feePercent != null ? Number(l.feePercent) : null, fixedFee: l.fixedFee != null ? Number(l.fixedFee) : null })),
      })),
      formas, (id) => nomeAdq.get(id) ?? null, (id) => nomeBand.get(id) ?? null,
    )

    return NextResponse.json({ formas: formasAgrupadas })
  } catch (error) {
    console.error('Erro ao listar taxas por forma:', error)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}
