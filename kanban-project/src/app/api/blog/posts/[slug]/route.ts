// ========================================
// CRIAR ARQUIVO: app/api/blog/posts/[slug]/route.ts
// ========================================
// API PÚBLICA - Busca post por slug

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

export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params
    
    const post = await prisma.blogPost.findFirst({
      where: {
        slug: slug,
        status: 'PUBLICADO',
        dataPublicacao: {
          lte: new Date()
        }
      },
      select: {
        id: true,
        titulo: true,
        slug: true,
        resumo: true,
        conteudo: true,
        imagemUrl: true,
        imagemAlt: true,
        categoria: true,
        tempoLeitura: true,
        dataPublicacao: true,
        destaque: true,
      }
    })
    
    if (!post) {
      return NextResponse.json(
        { error: 'Post não encontrado' },
        { status: 404, headers: corsHeaders }
      )
    }
    
    return NextResponse.json(post, { headers: corsHeaders })
    
  } catch (error) {
    console.error('Erro ao buscar post:', error)
    return NextResponse.json(
      { error: 'Erro ao buscar post' },
      { status: 500, headers: corsHeaders }
    )
  }
}