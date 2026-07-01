import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verificarPermissao } from '@/src/lib/verificar-permissao'

export async function GET(request: NextRequest) {
  const erro = await verificarPermissao(request, 'usuarios.gerenciar')
  if (erro) return erro
  try {
    const orgaos = await prisma.orgaoProtocolo.findMany({ orderBy: { name: 'asc' } })
    return NextResponse.json({ orgaos })
  } catch (e) {
    console.error('GET orgaos-protocolo', e)
    return NextResponse.json({ error: 'Erro ao carregar órgãos.' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const erro = await verificarPermissao(request, 'usuarios.gerenciar')
  if (erro) return erro
  try {
    const b = await request.json()
    if (!b.name || !String(b.name).trim()) return NextResponse.json({ error: 'Informe o nome.' }, { status: 400 })
    const orgao = await prisma.orgaoProtocolo.create({
      data: {
        name: String(b.name).trim(),
        type: b.type ? String(b.type) : null,
        country: b.country ? String(b.country) : null,
        state: b.state ? String(b.state) : null,
        city: b.city ? String(b.city) : null,
        queueRule: b.queueRule ? String(b.queueRule) : null,
        ativo: b.ativo !== false,
      },
    })
    return NextResponse.json({ orgao }, { status: 201 })
  } catch (e) {
    console.error('POST orgaos-protocolo', e)
    return NextResponse.json({ error: 'Erro ao criar órgão.' }, { status: 500 })
  }
}