import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET() {
  try {
    // Teste simples de conexão
    const userCount = await prisma.usuario.count()
    
    return NextResponse.json({ 
      message: 'Conexão com banco funcionando!',
      userCount,
      status: 'success'
    })
    
  } catch (error) {
    console.error('Erro na conexão com o banco:', error)
    return NextResponse.json(
      { 
        message: 'Erro na conexão com o banco',
        error: error instanceof Error ? error.message : 'Erro desconhecido',
        status: 'error'
      },
      { status: 500 }
    )
  }
}