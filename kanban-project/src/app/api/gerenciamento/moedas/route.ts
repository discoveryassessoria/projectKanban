import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verificarPermissao } from '@/src/lib/verificar-permissao'

function toStrOrNull(v: any): string | null {
  if (v === undefined || v === null) return null
  const s = String(v).trim()
  return s === '' ? null : s
}

// GET - Listar moedas cadastradas
export async function GET(request: NextRequest) {
  try {
    const erro = await verificarPermissao(request, 'usuarios.gerenciar')
    if (erro) return erro

    const moedas = await prisma.moedaCadastro.findMany({ orderBy: { code: 'asc' } })
    return NextResponse.json({ moedas })
  } catch (error) {
    console.error('Erro ao listar moedas:', error)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}

// POST - Criar moeda
export async function POST(request: NextRequest) {
  try {
    const erro = await verificarPermissao(request, 'usuarios.gerenciar')
    if (erro) return erro

    const b = await request.json()
    if (!b.code || !String(b.code).trim()) {
      return NextResponse.json({ error: 'Informe o código.' }, { status: 400 })
    }

    const moeda = await prisma.moedaCadastro.create({
      data: {
        code: String(b.code).trim().toUpperCase(),
        name: toStrOrNull(b.name),
        symbol: toStrOrNull(b.symbol),
      },
    })

    return NextResponse.json({ moeda })
  } catch (error: any) {
    if (error?.code === 'P2002') {
      return NextResponse.json({ error: 'Já existe uma moeda com esse código.' }, { status: 409 })
    }
    console.error('Erro ao criar moeda:', error)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}