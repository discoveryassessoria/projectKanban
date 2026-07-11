import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET() {
  // CP-SEC — endpoint de diagnóstico indisponível em produção.
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Não encontrado' }, { status: 404 })
  }

  try {
    const userCount = await prisma.usuario.count()

    return NextResponse.json({
      message: 'Conexão com banco funcionando!',
      userCount,
      status: 'success'
    })
  } catch (error) {
    // CP-SEC — não vaza detalhes internos do erro/banco.
    console.error('Erro na conexão com o banco:', error)
    return NextResponse.json(
      { message: 'Erro na conexão com o banco', status: 'error' },
      { status: 500 }
    )
  }
}
