// ========================================
// CRIAR ARQUIVO: app/api/blog/posts/route.ts
// ========================================
// API PÚBLICA - Não requer autenticação
// Retorna posts publicados para a landing page

import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

// Headers CORS para permitir acesso da landing page
const corsHeaders = {
  'Access-Control-Allow-Origin': '*', // Em produção: 'https://discovery.com.br'
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

export async function OPTIONS() {
  return NextResponse.json({}, { headers: corsHeaders })
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const limit = parseInt(searchParams.get('limit') || '6')
    const categoria = searchParams.get('categoria')
    
    const where: any = {
      status: 'PUBLICADO',
      dataPublicacao: {
        lte: new Date()
      }
    }
    
    if (categoria) {
      where.categoria = categoria
    }
    
    const posts = await prisma.blogPost.findMany({
      where,
      orderBy: [
        { destaque: 'desc' },
        { dataPublicacao: 'desc' }
      ],
      take: limit,
      select: {
        id: true,
        titulo: true,
        slug: true,
        resumo: true,
        imagemUrl: true,
        imagemAlt: true,
        categoria: true,
        tempoLeitura: true,
        dataPublicacao: true,
        destaque: true,
      }
    })
    
    return NextResponse.json(posts, { headers: corsHeaders })
    
  } catch (error) {
    console.error('Erro ao buscar posts:', error)
    return NextResponse.json(
      { error: 'Erro ao buscar posts' },
      { status: 500, headers: corsHeaders }
    )
  }
}