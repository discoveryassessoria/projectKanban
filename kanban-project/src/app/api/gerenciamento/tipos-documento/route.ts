import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verificarPermissao } from '@/src/lib/verificar-permissao'
import { legacyFromCode } from '@/src/lib/document-category-map'

// Classificação CANÔNICA = categoriaDocumental (por ID). A relação é sempre
// carregada para a UI exibir o nome do mestre (sem mapa local). A coluna legada
// `category` só existe como fallback transitório e NÃO é editável pela UI nova.
const INCLUDE_CATEGORIA = {
  categoriaDocumental: { select: { id: true, code: true, name: true, ativo: true } },
} as const

export async function GET(request: NextRequest) {
  const erro = await verificarPermissao(request, 'usuarios.gerenciar')
  if (erro) return erro
  try {
    const tipos = await prisma.tipoDocumentoCadastro.findMany({ orderBy: { name: 'asc' }, include: INCLUDE_CATEGORIA })
    return NextResponse.json({ tipos })
  } catch (e) {
    console.error('GET tipos-documento', e)
    return NextResponse.json({ error: 'Erro ao carregar tipos de documento.' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const erro = await verificarPermissao(request, 'usuarios.gerenciar')
  if (erro) return erro
  try {
    const b = await request.json()
    if (!b.name || !String(b.name).trim()) return NextResponse.json({ error: 'Informe o nome.' }, { status: 400 })

    // LOTE A — FONTE CANÔNICA = categoriaDocumentalId (por ID). Valida existência.
    // DUAL-WRITE: deriva a coluna legada `category` a partir do code SÓ como
    // compatibilidade. Categoria nova sem equivalência legada (ex.: MILITAR) grava
    // a FK normalmente e deixa `category` null — nunca rejeita categoria válida.
    // A UI nova NÃO envia `category`; não se infere a fonte principal por texto.
    let categoriaDocumentalId: number | null = null
    let categoryLegado: string | null = null
    if (b.categoriaDocumentalId != null) {
      const cid = Number(b.categoriaDocumentalId)
      if (!Number.isInteger(cid)) return NextResponse.json({ error: 'Categoria documental inválida.' }, { status: 400 })
      const cat = await prisma.categoriaDocumental.findUnique({ where: { id: cid } })
      if (!cat) return NextResponse.json({ error: 'Categoria documental não encontrada.' }, { status: 404 })
      categoriaDocumentalId = cat.id
      categoryLegado = legacyFromCode(cat.code) // null quando não há legado → ok
    } else if (b.category) {
      // caminho legado puro (sem FK) — só compat; deprecado para a UI nova
      categoryLegado = String(b.category)
    }

    const tipo = await prisma.tipoDocumentoCadastro.create({
      data: {
        code: b.code ? String(b.code) : null,
        name: String(b.name).trim(),
        category: categoryLegado,
        categoriaDocumentalId,
        ativo: b.ativo !== false,
      },
      include: INCLUDE_CATEGORIA,
    })
    return NextResponse.json({ tipo }, { status: 201 })
  } catch (e) {
    console.error('POST tipos-documento', e)
    return NextResponse.json({ error: 'Erro ao criar tipo de documento.' }, { status: 500 })
  }
}