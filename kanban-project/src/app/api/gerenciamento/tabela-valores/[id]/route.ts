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
    if (b.valor !== undefined && toAmount(b.valor) <= 0) {
      return NextResponse.json({ error: 'Valor deve ser maior que zero.' }, { status: 400 })
    }
    try {
      const regra = await prisma.tabelaValor.update({
        where: { id },
        data: {
          // config (chave) é imutável na edição; aqui muda-se preço/contexto/vigência/prioridade.
          name: b.name !== undefined ? String(b.name).trim() : atual.name,
          processoTipoId: b.processoTipoId !== undefined ? (b.processoTipoId ? String(b.processoTipoId).trim() : null) : atual.processoTipoId,
          modalidadeId: b.modalidadeId !== undefined ? (b.modalidadeId ? Number(b.modalidadeId) : null) : atual.modalidadeId,
          fornecedorId: b.fornecedorId !== undefined ? (b.fornecedorId ? Number(b.fornecedorId) : null) : atual.fornecedorId,
          moeda: b.moeda !== undefined ? b.moeda : atual.moeda,
          valor: b.valor !== undefined ? toAmount(b.valor) : atual.valor,
          modoCalculo: b.modoCalculo !== undefined ? b.modoCalculo : atual.modoCalculo,
          unidade: b.unidade !== undefined ? (b.unidade || null) : atual.unidade,
          quantidadeMinima: b.quantidadeMinima !== undefined ? (b.quantidadeMinima === '' || b.quantidadeMinima == null ? null : Number(b.quantidadeMinima)) : atual.quantidadeMinima,
          quantidadeMaxima: b.quantidadeMaxima !== undefined ? (b.quantidadeMaxima === '' || b.quantidadeMaxima == null ? null : Number(b.quantidadeMaxima)) : atual.quantidadeMaxima,
          vigenciaInicio: b.vigenciaInicio !== undefined ? (b.vigenciaInicio ? String(b.vigenciaInicio) : null) : atual.vigenciaInicio,
          vigenciaFim: b.vigenciaFim !== undefined ? (b.vigenciaFim ? String(b.vigenciaFim) : null) : atual.vigenciaFim,
          prioridade: b.prioridade !== undefined ? (Number(b.prioridade) || 0) : atual.prioridade,
          arquivado: b.arquivado !== undefined ? !!b.arquivado : atual.arquivado,
        },
        include: { fornecedor: { select: { id: true, nome: true } } },
      })
      return NextResponse.json({ regra })
    } catch (e: any) {
      if (e?.code === 'P2002') return NextResponse.json({ error: 'Preço duplicado no mesmo contexto/prioridade/vigência.' }, { status: 409 })
      throw e
    }
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