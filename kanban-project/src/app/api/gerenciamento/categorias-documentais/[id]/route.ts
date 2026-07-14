import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verificarPermissao } from '@/src/lib/verificar-permissao'
import { legacyFromCode } from '@/src/lib/document-category-map'

const normCode = (s: string) => s.trim().toUpperCase().replace(/\s+/g, '_')
async function pid(params: Promise<{ id: string }>): Promise<number | null> {
  const { id } = await params
  const n = parseInt(id)
  return Number.isNaN(n) ? null : n
}

/** Conta vínculos de UMA categoria: FK + legado (linhas não migradas). Sem dupla contagem. */
async function contarUsos(id: number, code: string) {
  const fk = await prisma.tipoDocumentoCadastro.count({ where: { categoriaDocumentalId: id } })
  const legacy = legacyFromCode(code)
  const legado = legacy
    ? await prisma.tipoDocumentoCadastro.count({ where: { categoriaDocumentalId: null, category: legacy } })
    : 0
  return { total: fk + legado, fk, legado }
}

// GET — detalhe (com contagem híbrida de tipos vinculados)
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const erro = await verificarPermissao(request, 'usuarios.gerenciar'); if (erro) return erro
  const id = await pid(params); if (id == null) return NextResponse.json({ error: 'ID inválido' }, { status: 400 })
  const c = await prisma.categoriaDocumental.findUnique({ where: { id } })
  if (!c) return NextResponse.json({ error: 'Categoria não encontrada.' }, { status: 404 })
  const usos = await contarUsos(c.id, c.code)
  return NextResponse.json({ categoria: { ...c, tiposCount: usos.total, tiposCountFk: usos.fk, tiposCountLegado: usos.legado } })
}

// PUT — editar. `code` é IMUTÁVEL após criação (A3): protege ponte/backfill/integrações.
// nome/descrição/ordem/status editáveis. Categorias de sistema não podem mudar code.
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const erro = await verificarPermissao(request, 'usuarios.gerenciar'); if (erro) return erro
  const id = await pid(params); if (id == null) return NextResponse.json({ error: 'ID inválido' }, { status: 400 })
  try {
    const atual = await prisma.categoriaDocumental.findUnique({ where: { id } })
    if (!atual) return NextResponse.json({ error: 'Categoria não encontrada.' }, { status: 404 })
    const b = await request.json()

    // code imutável: só rejeita se tentarem MUDAR (enviar o mesmo é no-op).
    if (b.code !== undefined && normCode(String(b.code)) !== atual.code) {
      return NextResponse.json(
        { error: 'O código da categoria é imutável após a criação (evita quebrar vínculos e integrações).', code: 'CODE_IMMUTABLE' },
        { status: 409 },
      )
    }

    const data: Record<string, unknown> = {}
    if (b.name !== undefined) {
      const nm = String(b.name).trim()
      if (!nm) return NextResponse.json({ error: 'Nome não pode ficar vazio.' }, { status: 400 })
      data.name = nm
    }
    if (b.description !== undefined) data.description = b.description ? String(b.description).trim() : null
    if (b.ordem !== undefined) data.ordem = Number(b.ordem) || 0
    if (b.ativo !== undefined) data.ativo = !!b.ativo
    const categoria = await prisma.categoriaDocumental.update({ where: { id }, data })
    return NextResponse.json({ categoria })
  } catch (e) {
    console.error('PUT categorias-documentais', e)
    return NextResponse.json({ error: 'Erro ao atualizar categoria.' }, { status: 500 })
  }
}

// PATCH — ativar/inativar (archive/reactivate). Não exclui; preserva vínculos antigos.
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const erro = await verificarPermissao(request, 'usuarios.gerenciar'); if (erro) return erro
  const id = await pid(params); if (id == null) return NextResponse.json({ error: 'ID inválido' }, { status: 400 })
  const b = await request.json().catch(() => ({}))
  if (typeof b.ativo !== 'boolean') return NextResponse.json({ error: 'Informe { ativo: boolean }.' }, { status: 400 })
  const exists = await prisma.categoriaDocumental.findUnique({ where: { id } })
  if (!exists) return NextResponse.json({ error: 'Categoria não encontrada.' }, { status: 404 })
  const categoria = await prisma.categoriaDocumental.update({ where: { id }, data: { ativo: b.ativo } })
  return NextResponse.json({ categoria })
}

// DELETE — proibido p/ categorias de SISTEMA; e proibido enquanto houver QUALQUER
// vínculo (FK ou legado). Caso contrário 409 com o detalhamento. Nunca apaga dados.
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const erro = await verificarPermissao(request, 'usuarios.gerenciar'); if (erro) return erro
  const id = await pid(params); if (id == null) return NextResponse.json({ error: 'ID inválido' }, { status: 400 })
  const exists = await prisma.categoriaDocumental.findUnique({ where: { id } })
  if (!exists) return NextResponse.json({ error: 'Categoria não encontrada.' }, { status: 404 })
  if (exists.sistema) {
    return NextResponse.json(
      { error: 'Categoria de sistema não pode ser excluída. Inative se necessário.', code: 'SYSTEM' },
      { status: 409 },
    )
  }
  const usos = await contarUsos(exists.id, exists.code)
  if (usos.total > 0) {
    return NextResponse.json(
      {
        error: `Categoria em uso por ${usos.total} tipo(s) de documento (${usos.fk} por vínculo, ${usos.legado} legado). Inative em vez de excluir.`,
        code: 'IN_USE', usos: usos.total, usosFk: usos.fk, usosLegado: usos.legado,
      },
      { status: 409 },
    )
  }
  await prisma.categoriaDocumental.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
