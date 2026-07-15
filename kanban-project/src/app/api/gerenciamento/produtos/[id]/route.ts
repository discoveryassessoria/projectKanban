// src/app/api/gerenciamento/produtos/[id]/route.ts
// PUT    - Atualizar produto financeiro
// DELETE - Excluir produto financeiro
//
// ✅ Next 15: params é Promise → await params.
// Nada referencia ProdutoFinanceiro → delete livre.

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verificarPermissao } from '@/src/lib/verificar-permissao'

const MOEDAS = ['BRL', 'EUR', 'USD']
const s = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)
function parseDecimal(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

// PUT - Atualizar
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const erro = await verificarPermissao(request, 'usuarios.gerenciar')
    if (erro) return erro

    const { id: idParam } = await params
    const id = Number(idParam)
    if (!id || Number.isNaN(id)) {
      return NextResponse.json({ error: 'ID inválido' }, { status: 400 })
    }

    const atual = await prisma.produtoFinanceiro.findUnique({ where: { id } })
    if (!atual) {
      return NextResponse.json({ error: 'Produto não encontrado' }, { status: 404 })
    }

    const b = await request.json()

    if (b.codigo !== undefined && !String(b.codigo).trim()) {
      return NextResponse.json({ error: 'Código não pode ficar vazio' }, { status: 400 })
    }
    if (b.nome !== undefined && !String(b.nome).trim()) {
      return NextResponse.json({ error: 'Nome não pode ficar vazio' }, { status: 400 })
    }
    if (b.moedaPadrao !== undefined && b.moedaPadrao && !MOEDAS.includes(b.moedaPadrao)) {
      return NextResponse.json({ error: 'Moeda inválida' }, { status: 400 })
    }

    const codigo = b.codigo !== undefined ? String(b.codigo).trim() : atual.codigo
    const nome = b.nome !== undefined ? String(b.nome).trim() : atual.nome
    // R20 — a entidade mestre é IMUTÁVEL na edição: rejeita troca silenciosa de
    // Documento↔Serviço↔Processo↔Honorário (trocar origem = novo registro).
    const trocaMestre =
      (b.tipoDocumentoId !== undefined && (b.tipoDocumentoId ? Number(b.tipoDocumentoId) : null) !== atual.tipoDocumentoId) ||
      (b.honorarioId !== undefined && (b.honorarioId ? Number(b.honorarioId) : null) !== atual.honorarioId) ||
      (b.tipoProcessoId !== undefined && (b.tipoProcessoId ? Number(b.tipoProcessoId) : null) !== atual.tipoProcessoId) ||
      (b.itemCatalogoId !== undefined && (b.itemCatalogoId ? Number(b.itemCatalogoId) : null) !== atual.itemCatalogoId) ||
      (b.papelFinanceiro !== undefined && b.papelFinanceiro && b.papelFinanceiro !== atual.papelFinanceiro)
    if (trocaMestre) {
      return NextResponse.json({ error: 'Não é permitido trocar a entidade mestre ou o papel de uma configuração existente. Crie uma nova configuração e inative esta.' }, { status: 400 })
    }
    const produto = await prisma.$transaction(async (tx) => {
      // LOTE B — dual-write de NOME no MESMO item mestre (pivô imutável, R20):
      // atualiza o rótulo do ItemCatalogo vinculado sem re-derivar/trocar o pivô.
      if (atual.itemCatalogoId != null && nome !== atual.nome) {
        await tx.itemCatalogo.update({ where: { id: atual.itemCatalogoId }, data: { name: nome } })
      }
      return tx.produtoFinanceiro.update({
        where: { id },
        data: {
          codigo,
          nome,
          especie: b.especie !== undefined ? s(b.especie) : atual.especie,
          tipoFinanceiro: b.tipoFinanceiro !== undefined ? s(b.tipoFinanceiro) : atual.tipoFinanceiro,
          categoriaId: b.categoriaId !== undefined ? (b.categoriaId ? Number(b.categoriaId) : null) : atual.categoriaId,
          planoContaId: b.planoContaId !== undefined ? (b.planoContaId ? Number(b.planoContaId) : null) : atual.planoContaId,
          moedaPadrao: b.moedaPadrao !== undefined ? (b.moedaPadrao || 'BRL') : atual.moedaPadrao,
          valorPadrao: b.valorPadrao !== undefined ? parseDecimal(b.valorPadrao) : atual.valorPadrao,
          aplicaA: b.aplicaA !== undefined ? s(b.aplicaA) : atual.aplicaA,
          cobravelDoCliente: b.cobravelDoCliente !== undefined ? !!b.cobravelDoCliente : atual.cobravelDoCliente,
          ativo: b.ativo !== undefined ? !!b.ativo : atual.ativo,
          naturezaFinanceira: b.naturezaFinanceira !== undefined ? (b.naturezaFinanceira || 'revenue') : atual.naturezaFinanceira,
          custoInterno: b.custoInterno !== undefined ? !!b.custoInterno : atual.custoInterno,
          repasse: b.repasse !== undefined ? !!b.repasse : atual.repasse,
          reembolsavel: b.reembolsavel !== undefined ? !!b.reembolsavel : atual.reembolsavel,
          // itemCatalogoId (pivô/mestre) NÃO é alterado na edição — R20.
        },
      })
    })

    return NextResponse.json({ produto })
  } catch (error) {
    console.error('Erro ao atualizar produto:', error)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}

// DELETE - Excluir
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const erro = await verificarPermissao(request, 'usuarios.gerenciar')
    if (erro) return erro

    const { id: idParam } = await params
    const id = Number(idParam)
    if (!id || Number.isNaN(id)) {
      return NextResponse.json({ error: 'ID inválido' }, { status: 400 })
    }

    const atual = await prisma.produtoFinanceiro.findUnique({ where: { id } })
    if (!atual) {
      return NextResponse.json({ error: 'Produto não encontrado' }, { status: 404 })
    }

    // R19 — não excluir fisicamente configuração com PREÇOS vinculados (perderia
    // histórico e órfãos por SetNull). Inativa (arquiva) preservando o vínculo.
    const precos = await prisma.tabelaValor.count({ where: { configuracaoFinanceiraItemId: id } })
    if (precos > 0) {
      await prisma.produtoFinanceiro.update({ where: { id }, data: { ativo: false } })
      return NextResponse.json({ ok: true, inativado: true, motivo: `Configuração possui ${precos} preço(s) vinculado(s); foi inativada (não excluída) para preservar histórico.` })
    }
    // sem preços vinculados: inativa também (padrão de arquivamento, não hard-delete).
    await prisma.produtoFinanceiro.update({ where: { id }, data: { ativo: false } })
    return NextResponse.json({ ok: true, inativado: true })
  } catch (error) {
    console.error('Erro ao excluir produto:', error)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}