// ESTE ARQUIVO VAI EM: src/app/api/gerenciamento/paises/[countryKey]/modalidades/route.ts
//
// GET  - lista TODAS as modalidades do país (ativas e inativas) + quantos
//        tipos usam cada uma (pra saber se pode excluir)
// POST - cria modalidade nova no país

import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verificarPermissao } from '@/src/lib/verificar-permissao'

// "Recurso / Exigência" -> "recurso_exigencia"
function slug(s: string) {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

export async function GET(request: Request, { params }: { params: Promise<{ countryKey: string }> }) {
  const erro = await verificarPermissao(request, 'usuarios.gerenciar')
  if (erro) return erro

  try {
    const { countryKey } = await params
    const pais = await prisma.catalogoPais.findUnique({ where: { countryKey } })
    if (!pais) return NextResponse.json({ error: 'País não encontrado.' }, { status: 404 })

    const [mods, tipos] = await Promise.all([
      prisma.modalidadePais.findMany({ where: { countryKey }, orderBy: { ordem: 'asc' } }),
      prisma.tipoProcessoNacionalidade.findMany({ where: { countryKey }, select: { modalityKey: true } }),
    ])

    const contagem = new Map<string, number>()
    for (const t of tipos) contagem.set(t.modalityKey, (contagem.get(t.modalityKey) || 0) + 1)

    const out = mods.map((m) => ({ ...m, tiposCount: contagem.get(m.modalityKey) || 0 }))
    return NextResponse.json({ modalidades: out })
  } catch (error) {
    console.error('Erro ao listar modalidades:', error)
    return NextResponse.json({ error: 'Erro ao listar modalidades' }, { status: 500 })
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ countryKey: string }> }) {
  const erro = await verificarPermissao(request, 'usuarios.gerenciar')
  if (erro) return erro

  try {
    const { countryKey } = await params
    const pais = await prisma.catalogoPais.findUnique({ where: { countryKey } })
    if (!pais) return NextResponse.json({ error: 'País não encontrado.' }, { status: 404 })

    const body = await request.json().catch(() => ({}))
    const modalityLabel = String(body?.modalityLabel || '').trim()
    if (!modalityLabel) return NextResponse.json({ error: 'Informe o nome da modalidade.' }, { status: 400 })

    const modalityKey = String(body?.modalityKey || '').trim() || slug(modalityLabel)
    if (!modalityKey) return NextResponse.json({ error: 'Não foi possível gerar a chave da modalidade.' }, { status: 400 })

    const existe = await prisma.modalidadePais.findUnique({
      where: { countryKey_modalityKey: { countryKey, modalityKey } },
    })
    if (existe) return NextResponse.json({ error: `Este país já tem a modalidade "${modalityKey}".` }, { status: 409 })

    const total = await prisma.modalidadePais.count({ where: { countryKey } })

    const modalidade = await prisma.modalidadePais.create({
      data: {
        countryKey,
        modalityKey,
        modalityLabel,
        codeSuffix: body?.codeSuffix ? String(body.codeSuffix).trim() : null,
        ordem: typeof body?.ordem === 'number' ? body.ordem : total,
        ativo: true,
      },
    })

    return NextResponse.json({ modalidade }, { status: 201 })
  } catch (e: any) {
    console.error('Erro ao criar modalidade:', e)
    return NextResponse.json({ error: e?.message || 'Erro ao criar modalidade.' }, { status: 500 })
  }
}