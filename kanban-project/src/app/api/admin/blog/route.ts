// ========================================
// CRIAR ARQUIVO: app/api/admin/blog/route.ts
// ========================================

import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

// GET - Listar todos os posts
export async function GET() {
  try {
    const posts = await prisma.blogPost.findMany({
      orderBy: { createdAt: 'desc' }
    })
    
    return NextResponse.json(posts)
  } catch (error) {
    console.error('Erro ao buscar posts:', error)
    return NextResponse.json({ error: 'Erro ao buscar posts' }, { status: 500 })
  }
}

// POST - Criar novo post
export async function POST(request: Request) {
  try {
    const data = await request.json()
    
    // Gerar slug a partir do título se não for fornecido
    const slug = data.slug || data.titulo
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '')
    
    const post = await prisma.blogPost.create({
      data: {
        titulo: data.titulo,
        slug: slug,
        resumo: data.resumo,
        conteudo: data.conteudo || null,
        imagemUrl: data.imagemUrl || null,
        imagemAlt: data.imagemAlt || null,
        categoria: data.categoria,
        tempoLeitura: data.tempoLeitura || 5,
        status: data.status || 'RASCUNHO',
        destaque: data.destaque || false,
        dataPublicacao: data.dataPublicacao ? new Date(data.dataPublicacao) : null,
        metaTitle: data.metaTitle || null,
        metaDescription: data.metaDescription || null,
      }
    })
    
    return NextResponse.json(post, { status: 201 })
  } catch (error: any) {
    console.error('Erro ao criar post:', error)
    
    if (error.code === 'P2002') {
      return NextResponse.json(
        { error: 'Já existe um post com esse slug' },
        { status: 400 }
      )
    }
    
    return NextResponse.json({ error: 'Erro ao criar post' }, { status: 500 })
  }
}