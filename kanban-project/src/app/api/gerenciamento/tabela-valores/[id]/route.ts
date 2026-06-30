import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verificarPermissao } from '@/src/lib/verificar-permissao'

function toAmount(v: any): number {
  if (v === undefined || v === null || v === '') return 0
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

// PUT - Atualizar regra de valor
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const erro = await verificarPermissao(request, 'usuarios.gerenciar')
    if (erro) return erro

    const { id: idStr } = await params
    const id = Number(idStr)
    const atual = await prisma.tabelaValor.findUnique({ where: { id } })
    if (!atual) return NextResponse.json({ error: 'Regra não encontrada' }, { status: 404 })

    const b = await request.json()
    const regra = await prisma.tabelaValor.update({
      where: { id },
      data: {
        name: b.name !== undefined ? String(b.name).trim() : atual.name,
        processoTipoId: b.processoTipoId !== undefined ? (b.processoTipoId ? String(b.processoTipoId).trim() : null) : atual.processoTipoId,
        faseKey: b.faseKey !== undefined ? (b.faseKey ? String(b.faseKey).trim() : null) : atual.faseKey,
        produtoServicoId: b.produtoServicoId !== undefined ? (b.produtoServicoId ? String(b.produtoServicoId).trim() : null) : atual.produtoServicoId,
        fornecedorId: b.fornecedorId !== undefined ? (b.fornecedorId ? Number(b.fornecedorId) : null) : atual.fornecedorId,
        moeda: b.moeda !== undefined ? b.moeda : atual.moeda,
        valor: b.valor !== undefined ? toAmount(b.valor) : atual.valor,
        modoCalculo: b.modoCalculo !== undefined ? b.modoCalculo : atual.modoCalculo,
        condicao: b.condicao !== undefined ? (b.condicao ? String(b.condicao).trim() : null) : atual.condicao,
        vigenciaInicio: b.vigenciaInicio !== undefined ? (b.vigenciaInicio ? String(b.vigenciaInicio) : null) : atual.vigenciaInicio,
        vigenciaFim: b.vigenciaFim !== undefined ? (b.vigenciaFim ? String(b.vigenciaFim) : null) : atual.vigenciaFim,
        arquivado: b.arquivado !== undefined ? !!b.arquivado : atual.arquivado,
      },
      include: { fornecedor: { select: { id: true, nome: true } } },
    })

    return NextResponse.json({ regra })
  } catch (error) {
    console.error('Erro ao atualizar regra de valor:', error)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}

// DELETE - Excluir regra de valor
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const erro = await verificarPermissao(request, 'usuarios.gerenciar')
    if (erro) return erro

    const { id: idStr } = await params
    const id = Number(idStr)
    await prisma.tabelaValor.delete({ where: { id } })

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('Erro ao excluir regra de valor:', error)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}