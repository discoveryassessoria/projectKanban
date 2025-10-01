import { NextRequest, NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

export async function GET() {
  try {
    const status = await prisma.status.findMany({
      select: {
        id: true,
        nome: true
      },
      orderBy: {
        id: 'asc'
      }
    })

    return NextResponse.json(status)
  } catch (error) {
    console.error('Erro ao buscar status:', error)
    return NextResponse.json({ error: 'Erro interno do servidor' }, { status: 500 })
  }
}