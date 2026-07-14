import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { verificarPermissao } from '@/src/lib/verificar-permissao'
import { codeFromLegacy } from '@/src/lib/document-category-map'

// LOTE A — API canônica de Categorias Documentais (FONTE CANÔNICA da classificação).
const normCode = (s: string) => s.trim().toUpperCase().replace(/\s+/g, '_')

/**
 * Contagem HÍBRIDA de "docs vinculados" por categoria enquanto a coluna legada
 * existir: vínculos por FK (categoriaDocumentalId) + vínculos legados (category
 * mapeado via ponte, só nas linhas ainda NÃO migradas — categoriaDocumentalId null).
 * Sem dupla contagem. Retorna { totalPorId, fkPorId, legadoPorCode }.
 */
async function contarVinculos() {
  const fk = await prisma.tipoDocumentoCadastro.groupBy({
    by: ['categoriaDocumentalId'],
    where: { categoriaDocumentalId: { not: null } },
    _count: { _all: true },
  })
  const fkPorId = new Map<number, number>()
  for (const r of fk) if (r.categoriaDocumentalId != null) fkPorId.set(r.categoriaDocumentalId, r._count._all)

  const leg = await prisma.tipoDocumentoCadastro.groupBy({
    by: ['category'],
    where: { categoriaDocumentalId: null, category: { not: null } },
    _count: { _all: true },
  })
  const legadoPorCode = new Map<string, number>()
  for (const r of leg) {
    const code = codeFromLegacy(r.category)
    if (code) legadoPorCode.set(code, (legadoPorCode.get(code) ?? 0) + r._count._all)
  }
  return { fkPorId, legadoPorCode }
}

// GET — lista. ?status=ativas|inativas|todas (default ativas) · ?q= busca code/nome (no banco)
export async function GET(request: NextRequest) {
  const erro = await verificarPermissao(request, 'usuarios.gerenciar')
  if (erro) return erro
  try {
    const { searchParams } = new URL(request.url)
    const status = searchParams.get('status') || 'ativas'
    const q = (searchParams.get('q') || '').trim()

    const where: Prisma.CategoriaDocumentalWhereInput = {}
    if (status === 'ativas') where.ativo = true
    else if (status === 'inativas') where.ativo = false
    if (q) where.OR = [
      { code: { contains: q, mode: 'insensitive' } },
      { name: { contains: q, mode: 'insensitive' } },
    ]

    const cats = await prisma.categoriaDocumental.findMany({ where, orderBy: [{ ordem: 'asc' }, { name: 'asc' }] })
    const { fkPorId, legadoPorCode } = await contarVinculos()

    const categorias = cats.map((c) => {
      const fk = fkPorId.get(c.id) ?? 0
      const legado = legadoPorCode.get(c.code) ?? 0
      return {
        id: c.id, code: c.code, name: c.name, description: c.description,
        ordem: c.ordem, ativo: c.ativo, sistema: c.sistema,
        tiposCount: fk + legado, tiposCountFk: fk, tiposCountLegado: legado,
      }
    })
    return NextResponse.json({ categorias })
  } catch (e) {
    console.error('GET categorias-documentais', e)
    return NextResponse.json({ error: 'Erro ao carregar categorias documentais.' }, { status: 500 })
  }
}

// POST — criar (código único; nome obrigatório; trim; código normalizado)
export async function POST(request: NextRequest) {
  const erro = await verificarPermissao(request, 'usuarios.gerenciar')
  if (erro) return erro
  try {
    const b = await request.json()
    const name = String(b.name ?? '').trim()
    if (!name) return NextResponse.json({ error: 'Informe o nome.' }, { status: 400 })
    const code = normCode(String(b.code ?? name))
    if (!code) return NextResponse.json({ error: 'Informe o código.' }, { status: 400 })
    const dup = await prisma.categoriaDocumental.findUnique({ where: { code } })
    if (dup) return NextResponse.json({ error: `Já existe categoria com o código "${code}".`, code: 'DUPLICATE' }, { status: 409 })
    const categoria = await prisma.categoriaDocumental.create({
      data: {
        code, name,
        description: b.description ? String(b.description).trim() : null,
        ordem: Number.isFinite(Number(b.ordem)) ? Number(b.ordem) : 0,
        ativo: b.ativo !== false,
        // sistema NUNCA é definido pela API — só o seed de bootstrap cria sistema=true
      },
    })
    return NextResponse.json({ categoria }, { status: 201 })
  } catch (e) {
    console.error('POST categorias-documentais', e)
    return NextResponse.json({ error: 'Erro ao criar categoria documental.' }, { status: 500 })
  }
}
