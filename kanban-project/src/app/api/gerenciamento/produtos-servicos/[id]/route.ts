import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verificarPermissao } from '@/src/lib/verificar-permissao'
import { sincronizarItemDeServico } from '@/src/services/catalogo-sync'

function toStrOrNull(v: any): string | null {
  if (v === undefined || v === null) return null
  const s = String(v).trim()
  return s === '' ? null : s
}
// PUT - Atualizar serviço
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const erro = await verificarPermissao(request, 'usuarios.gerenciar')
    if (erro) return erro

    const { id: idStr } = await params
    const id = Number(idStr)
    const atual = await prisma.servicoProduto.findUnique({ where: { id } })
    if (!atual) return NextResponse.json({ error: 'Serviço não encontrado' }, { status: 404 })

    const b = await request.json()
    const data: any = {
      code: b.code !== undefined ? String(b.code).trim() : atual.code,
      name: b.name !== undefined ? String(b.name).trim() : atual.name,
      category: b.category !== undefined ? toStrOrNull(b.category) : atual.category,
      descricao: b.descricao !== undefined ? toStrOrNull(b.descricao) : atual.descricao,
      unidadePadrao: b.unidadePadrao !== undefined ? (b.unidadePadrao || null) : atual.unidadePadrao,
      nationality: b.nationality !== undefined ? ((String(b.nationality).trim()) || 'all') : atual.nationality,
      ativo: b.ativo !== undefined ? !!b.ativo : atual.ativo,
    }

    // dual-write: re-sincroniza o ItemCatalogo (mestre) com os valores efetivos.
    // Renomeia o item JÁ vinculado no lugar (preserva itemCatalogoId dos consumidores,
    // ex.: Configuração Financeira) — editar o CÓDIGO do serviço não quebra o vínculo.
    const servico = await prisma.$transaction(async (tx) => {
      const itemCatalogoId = await sincronizarItemDeServico(tx, { code: data.code, name: data.name, category: data.category }, atual.itemCatalogoId)
      return tx.servicoProduto.update({
        where: { id },
        data: { ...data, itemCatalogoId },
      })
    })

    return NextResponse.json({ servico })
  } catch (error: any) {
    if (error?.code === 'P2002') {
      return NextResponse.json({ error: 'Já existe um serviço com esse código.' }, { status: 409 })
    }
    console.error('Erro ao atualizar produto/serviço:', error)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}

// DELETE - Excluir serviço (os vínculos M2M somem junto)
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const erro = await verificarPermissao(request, 'usuarios.gerenciar')
    if (erro) return erro

    const { id: idStr } = await params
    const id = Number(idStr)
    await prisma.servicoProduto.delete({ where: { id } })

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('Erro ao excluir produto/serviço:', error)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}