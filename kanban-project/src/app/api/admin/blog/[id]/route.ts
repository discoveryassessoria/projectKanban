// ========================================
// CRIAR ARQUIVO: app/api/admin/blog/[id]/route.ts
// ========================================

import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

// GET - Buscar post por ID
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    
    const post = await prisma.blogPost.findUnique({
      where: { id: parseInt(id) }
    })
    
    if (!post) {
      return NextResponse.json({ error: 'Post não encontrado' }, { status: 404 })
    }
    
    return NextResponse.json(post)
  } catch (error) {
    return NextResponse.json({ error: 'Erro ao buscar post' }, { status: 500 })
  }
}

// PUT - Atualizar post
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const data = await request.json()
    
    const post = await prisma.blogPost.update({
      where: { id: parseInt(id) },
      data: {
        titulo: data.titulo,
        slug: data.slug,
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
    
    return NextResponse.json(post)
  } catch (error: any) {
    console.error('Erro ao atualizar post:', error)
    
    if (error.code === 'P2002') {
      return NextResponse.json(
        { error: 'Já existe um post com esse slug' },
        { status: 400 }
      )
    }
    
    return NextResponse.json({ error: 'Erro ao atualizar post' }, { status: 500 })
  }
}

// DELETE - Excluir post
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    
    await prisma.blogPost.delete({
      where: { id: parseInt(id) }
    })
    
    return NextResponse.json({ message: 'Post excluído com sucesso' })
  } catch (error) {
    return NextResponse.json({ error: 'Erro ao excluir post' }, { status: 500 })
  }
}