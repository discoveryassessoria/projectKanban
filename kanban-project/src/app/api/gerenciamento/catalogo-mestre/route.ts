// src/app/api/gerenciamento/catalogo-mestre/route.ts
// LOTE D — Catálogo Mestre (ItemCatalogo): a FONTE ÚNICA de itens.
// GET lista; POST cria. Espelha o padrão de tabela-valores (verificarPermissao).
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verificarPermissao } from '@/src/lib/verificar-permissao'
import { NaturezaItem, UnidadeItem } from '@prisma/client'
import { slugTecnico, gerarChaveUnica } from '@/src/lib/catalogo/chave-tecnica-interna'
import { parseConsulta, filtroBusca, filtroAtivo, ordenacao, meta } from '@/lib/gerenciamento/consulta'
import { registrarAuditoria } from '@/lib/gerenciamento/auditoria'

function toStrOrNull(v: any): string | null {
  if (v === undefined || v === null) return null
  const s = String(v).trim()
  return s === '' ? null : s
}
const NATUREZAS = Object.values(NaturezaItem)
const UNIDADES = Object.values(UnidadeItem)

// GET - lista itens do catálogo (+ contadores de uso, p/ mostrar ligações)
export async function GET(request: NextRequest) {
  try {
    const erro = await verificarPermissao(request, 'usuarios.gerenciar')
    if (erro) return erro
    // Busca/ordenação/paginação/ativo via query params OPCIONAIS (retrocompatível).
    const c = parseConsulta(new URL(request.url).searchParams)
    const where = { ...filtroBusca(c.q, ['name', 'code', 'categoria']), ...filtroAtivo(c) }
    const [total, itens] = await Promise.all([
      prisma.itemCatalogo.count({ where }),
      prisma.itemCatalogo.findMany({
        where,
        orderBy: ordenacao(c, ['name', 'code', 'natureza', 'categoria', 'criadoEm'], [{ natureza: 'asc' }, { name: 'asc' }]),
        skip: c.skip,
        take: c.take,
        include: {
          _count: { select: { tiposDocumento: true, produtos: true, servicos: true, precos: true } },
        },
      }),
    ])
    return NextResponse.json({ itens, naturezas: NATUREZAS, unidades: UNIDADES, meta: meta(total, c) })
  } catch (error) {
    console.error('Erro ao listar catálogo mestre:', error)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}

// POST - cria item
export async function POST(request: NextRequest) {
  try {
    const erro = await verificarPermissao(request, 'usuarios.gerenciar')
    if (erro) return erro
    const b = await request.json()
    const name = toStrOrNull(b.name)
    if (!name) return NextResponse.json({ error: 'Informe o nome do item.' }, { status: 400 })

    const natureza = NATUREZAS.includes(b.natureza) ? b.natureza : NaturezaItem.OUTRO
    const unidade = UNIDADES.includes(b.unidade) ? b.unidade : UnidadeItem.UNIDADE

    // CHAVE TÉCNICA INTERNA: gerada no backend a partir do nome (o operador nunca informa `code`).
    const code = await gerarChaveUnica(slugTecnico(name, 'ITEM'), async (c) =>
      !!(await prisma.itemCatalogo.findUnique({ where: { code: c }, select: { id: true } })),
    )

    const item = await prisma.itemCatalogo.create({
      data: { code, name, descricao: toStrOrNull(b.descricao), natureza, categoria: toStrOrNull(b.categoria), unidade, ativo: b.ativo !== false },
    })
    await registrarAuditoria(request, { acao: 'CRIAR', entidade: 'ItemCatalogo', entidadeId: item.id, descricao: `Item mestre criado: ${name}`, detalhes: { code, natureza, categoria: item.categoria } })
    return NextResponse.json(item, { status: 201 })
  } catch (error) {
    console.error('Erro ao criar item do catálogo:', error)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}