import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verificarPermissao } from '@/src/lib/verificar-permissao'

export async function GET(request: NextRequest) {
  const erro = await verificarPermissao(request, 'usuarios.gerenciar')
  if (erro) return erro
  try {
    const tipos = await prisma.tipoDocumentoCadastro.findMany({ orderBy: { name: 'asc' } })
    return NextResponse.json({ tipos })
  } catch (e) {
    console.error('GET tipos-documento', e)
    return NextResponse.json({ error: 'Erro ao carregar tipos de documento.' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const erro = await verificarPermissao(request, 'usuarios.gerenciar')
  if (erro) return erro
  try {
    const b = await request.json()
    if (!b.name || !String(b.name).trim()) return NextResponse.json({ error: 'Informe o nome.' }, { status: 400 })
    const tipo = await prisma.tipoDocumentoCadastro.create({
      data: {
        code: b.code ? String(b.code) : null,
        name: String(b.name).trim(),
        category: b.category ? String(b.category) : null,
        ativo: b.ativo !== false,
      },
    })
    return NextResponse.json({ tipo }, { status: 201 })
  } catch (e) {
    console.error('POST tipos-documento', e)
    return NextResponse.json({ error: 'Erro ao criar tipo de documento.' }, { status: 500 })
  }
}