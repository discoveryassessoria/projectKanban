import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verificarPermissao } from '@/src/lib/verificar-permissao'
import { legacyFromCode } from '@/src/lib/document-category-map'

// Classificação canônica sempre carregada (UI exibe o nome do mestre, sem mapa local).
const INCLUDE_CATEGORIA = {
  categoriaDocumental: { select: { id: true, code: true, name: true, ativo: true } },
} as const

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const erro = await verificarPermissao(request, 'usuarios.gerenciar')
  if (erro) return erro
  try {
    const { id: idStr } = await params
    const id = Number(idStr)
    const b = await request.json()
    const atual = await prisma.tipoDocumentoCadastro.findUnique({ where: { id } })
    if (!atual) return NextResponse.json({ error: 'Tipo não encontrado.' }, { status: 404 })

    // LOTE A — só reescreve a classificação quando o campo vem no body.
    // Enviado categoriaDocumentalId: valida (404) e faz dual-write da coluna
    // legada `category`. Enviado só `category` (legado): mantém o caminho antigo.
    // FONTE CANÔNICA = categoriaDocumentalId. Só reescreve a classificação quando o
    // campo vem no body (dual-read/idempotência). Salvar sem alterar preserva a FK.
    // DUAL-WRITE do `category` legado só como compat (categoria sem legado → null).
    let categoriaDocumentalId = atual.categoriaDocumentalId
    let categoryLegado = atual.category
    if (b.categoriaDocumentalId !== undefined) {
      if (b.categoriaDocumentalId === null) {
        categoriaDocumentalId = null
        // desvincular do mestre não apaga a coluna legada (histórico preservado)
      } else {
        const cid = Number(b.categoriaDocumentalId)
        if (!Number.isInteger(cid)) return NextResponse.json({ error: 'Categoria documental inválida.' }, { status: 400 })
        const cat = await prisma.categoriaDocumental.findUnique({ where: { id: cid } })
        if (!cat) return NextResponse.json({ error: 'Categoria documental não encontrada.' }, { status: 404 })
        categoriaDocumentalId = cat.id
        categoryLegado = legacyFromCode(cat.code) // sincroniza compat (null se sem legado)
      }
    } else if (b.category !== undefined) {
      categoryLegado = b.category ? String(b.category) : null
    }

    const tipo = await prisma.tipoDocumentoCadastro.update({
      where: { id },
      data: {
        code: b.code !== undefined ? (b.code ? String(b.code) : null) : atual.code,
        name: b.name !== undefined ? String(b.name).trim() : atual.name,
        category: categoryLegado,
        categoriaDocumentalId,
        ativo: b.ativo !== undefined ? !!b.ativo : atual.ativo,
      },
      include: INCLUDE_CATEGORIA,
    })
    return NextResponse.json({ tipo })
  } catch (e) {
    console.error('PUT tipos-documento/[id]', e)
    return NextResponse.json({ error: 'Erro ao salvar tipo.' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const erro = await verificarPermissao(request, 'usuarios.gerenciar')
  if (erro) return erro
  try {
    const { id: idStr } = await params
    const id = Number(idStr)
    const atual = await prisma.tipoDocumentoCadastro.findUnique({ where: { id } })
    if (!atual) return NextResponse.json({ error: 'Tipo não encontrado.' }, { status: 404 })
    await prisma.tipoDocumentoCadastro.delete({ where: { id } })
    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('DELETE tipos-documento/[id]', e)
    return NextResponse.json({ error: 'Erro ao excluir tipo.' }, { status: 500 })
  }
}