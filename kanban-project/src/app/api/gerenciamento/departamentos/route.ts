import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verificarPermissao } from '@/src/lib/verificar-permissao'

export async function GET(request: NextRequest) {
  const erro = await verificarPermissao(request, 'usuarios.gerenciar')
  if (erro) return erro
  try {
    const departamentos = await prisma.departamento.findMany({ orderBy: { name: 'asc' } })
    return NextResponse.json({ departamentos })
  } catch (e) {
    console.error('GET departamentos', e)
    return NextResponse.json({ error: 'Erro ao carregar departamentos.' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const erro = await verificarPermissao(request, 'usuarios.gerenciar')
  if (erro) return erro
  try {
    const b = await request.json()
    if (!b.name || !String(b.name).trim()) return NextResponse.json({ error: 'Informe o nome.' }, { status: 400 })
    const departamento = await prisma.departamento.create({
      data: {
        code: b.code ? String(b.code) : null,
        name: String(b.name).trim(),
        ativo: b.ativo !== false,
      },
    })
    return NextResponse.json({ departamento }, { status: 201 })
  } catch (e) {
    console.error('POST departamentos', e)
    return NextResponse.json({ error: 'Erro ao criar departamento.' }, { status: 500 })
  }
}