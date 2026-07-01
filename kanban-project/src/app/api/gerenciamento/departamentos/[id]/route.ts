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
    const atual = await prisma.departamento.findUnique({ where: { id } })
    if (!atual) return NextResponse.json({ error: 'Departamento não encontrado.' }, { status: 404 })
    const departamento = await prisma.departamento.update({
      where: { id },
      data: {
        code: b.code !== undefined ? (b.code ? String(b.code) : null) : atual.code,
        name: b.name !== undefined ? String(b.name).trim() : atual.name,
        ativo: b.ativo !== undefined ? !!b.ativo : atual.ativo,
      },
    })
    return NextResponse.json({ departamento })
  } catch (e) {
    console.error('PUT departamentos/[id]', e)
    return NextResponse.json({ error: 'Erro ao salvar departamento.' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const erro = await verificarPermissao(request, 'usuarios.gerenciar')
  if (erro) return erro
  try {
    const { id: idStr } = await params
    const id = Number(idStr)
    const atual = await prisma.departamento.findUnique({ where: { id } })
    if (!atual) return NextResponse.json({ error: 'Departamento não encontrado.' }, { status: 404 })
    await prisma.departamento.delete({ where: { id } })
    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('DELETE departamentos/[id]', e)
    return NextResponse.json({ error: 'Erro ao excluir departamento.' }, { status: 500 })
  }
}