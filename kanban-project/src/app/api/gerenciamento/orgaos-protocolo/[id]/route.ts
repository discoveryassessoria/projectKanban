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
    const atual = await prisma.orgaoProtocolo.findUnique({ where: { id } })
    if (!atual) return NextResponse.json({ error: 'Órgão não encontrado.' }, { status: 404 })
    const orgao = await prisma.orgaoProtocolo.update({
      where: { id },
      data: {
        name: b.name !== undefined ? String(b.name).trim() : atual.name,
        type: b.type !== undefined ? (b.type ? String(b.type) : null) : atual.type,
        country: b.country !== undefined ? (b.country ? String(b.country) : null) : atual.country,
        state: b.state !== undefined ? (b.state ? String(b.state) : null) : atual.state,
        city: b.city !== undefined ? (b.city ? String(b.city) : null) : atual.city,
        queueRule: b.queueRule !== undefined ? (b.queueRule ? String(b.queueRule) : null) : atual.queueRule,
        ativo: b.ativo !== undefined ? !!b.ativo : atual.ativo,
      },
    })
    return NextResponse.json({ orgao })
  } catch (e) {
    console.error('PUT orgaos-protocolo/[id]', e)
    return NextResponse.json({ error: 'Erro ao salvar órgão.' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const erro = await verificarPermissao(request, 'usuarios.gerenciar')
  if (erro) return erro
  try {
    const { id: idStr } = await params
    const id = Number(idStr)
    const atual = await prisma.orgaoProtocolo.findUnique({ where: { id } })
    if (!atual) return NextResponse.json({ error: 'Órgão não encontrado.' }, { status: 404 })
    await prisma.orgaoProtocolo.delete({ where: { id } })
    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('DELETE orgaos-protocolo/[id]', e)
    return NextResponse.json({ error: 'Erro ao excluir órgão.' }, { status: 500 })
  }
}