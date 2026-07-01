import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verificarPermissao } from '@/src/lib/verificar-permissao'

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const erro = await verificarPermissao(request, 'usuarios.gerenciar')
  if (erro) return erro
  try {
    const { id: idStr } = await params
    const id = Number(idStr)
    const b = await request.json()
    const atual = await prisma.tipoDocumentoCadastro.findUnique({ where: { id } })
    if (!atual) return NextResponse.json({ error: 'Tipo não encontrado.' }, { status: 404 })
    const tipo = await prisma.tipoDocumentoCadastro.update({
      where: { id },
      data: {
        code: b.code !== undefined ? (b.code ? String(b.code) : null) : atual.code,
        name: b.name !== undefined ? String(b.name).trim() : atual.name,
        category: b.category !== undefined ? (b.category ? String(b.category) : null) : atual.category,
        ativo: b.ativo !== undefined ? !!b.ativo : atual.ativo,
      },
    })
    return NextResponse.json({ tipo })
  } catch (e) {
    console.error('PUT tipos-documento/[id]', e)
    return NextResponse.json({ error: 'Erro ao salvar tipo.' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const erro = await verificarPermissao(request, 'usuarios.gerenciar')
  if (erro) return erro
  try {
    const { id: idStr } = await params
    const id = Number(idStr)
    const atual = await prisma.tipoDocumentoCadastro.findUnique({ where: { id } })
    if (!atual) return NextResponse.json({ error: 'Tipo não encontrado.' }, { status: 404 })
    await prisma.tipoDocumentoCadastro.delete({ where: { id } })
    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('DELETE tipos-documento/[id]', e)
    return NextResponse.json({ error: 'Erro ao excluir tipo.' }, { status: 500 })
  }
}