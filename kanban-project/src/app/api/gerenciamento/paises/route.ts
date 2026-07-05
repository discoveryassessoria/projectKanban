// ESTE ARQUIVO SUBSTITUI: src/app/api/gerenciamento/paises/route.ts
//
// GET  - lista TODOS os países (ativos e inativos) + quantos tipos cada um tem
//        (pro modal "Gerenciar países" — o GET de tipos-processo só traz ativos)
// POST - cria País (CatalogoPais) + Modalidades (ModalidadePais) — igual antes

import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verificarPermissao } from '@/src/lib/verificar-permissao'

// "França" -> "franca" | "Judicial" -> "judicial"
function slug(s: string) {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

type ModalidadeIn = { modalityKey?: string; modalityLabel?: string; codeSuffix?: string | null; ordem?: number }

// GET - todos os países + contagem de tipos (pra saber se pode excluir)
export async function GET(request: Request) {
  const erro = await verificarPermissao(request, 'usuarios.gerenciar')
  if (erro) return erro

  try {
    const [paises, tipos] = await Promise.all([
      prisma.catalogoPais.findMany({ orderBy: { countryLabel: 'asc' } }),
      prisma.tipoProcessoNacionalidade.findMany({ select: { countryKey: true } }),
    ])

    const contagem = new Map<string, number>()
    for (const t of tipos) contagem.set(t.countryKey, (contagem.get(t.countryKey) || 0) + 1)

    const out = paises.map((p) => ({ ...p, tiposCount: contagem.get(p.countryKey) || 0 }))
    return NextResponse.json({ paises: out })
  } catch (error) {
    console.error('Erro ao listar países:', error)
    return NextResponse.json({ error: 'Erro ao listar países' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  const erro = await verificarPermissao(request, 'usuarios.gerenciar')
  if (erro) return erro

  const body = await request.json().catch(() => ({}))

  const countryLabel = String(body?.countryLabel || '').trim()
  const nationalityLabel = String(body?.nationalityLabel || '').trim()
  if (!countryLabel) return NextResponse.json({ error: 'Informe o nome do país.' }, { status: 400 })
  if (!nationalityLabel) return NextResponse.json({ error: 'Informe a nacionalidade.' }, { status: 400 })

  const countryKey = String(body?.countryKey || '').trim() || slug(countryLabel)
  const nationalityKey = String(body?.nationalityKey || '').trim() || slug(nationalityLabel)
  if (!countryKey) return NextResponse.json({ error: 'Não foi possível gerar a chave do país.' }, { status: 400 })

  // modalidades (dedup por modalityKey)
  const entrada: ModalidadeIn[] = Array.isArray(body?.modalidades) ? body.modalidades : []
  const vistos = new Set<string>()
  const modalidades = entrada
    .map((m, i) => {
      const key = slug(String(m?.modalityKey || m?.modalityLabel || ''))
      const label = String(m?.modalityLabel || '').trim()
      if (!key || !label) return null
      return {
        modalityKey: key,
        modalityLabel: label,
        codeSuffix: m?.codeSuffix ? String(m.codeSuffix).trim() : null,
        ordem: typeof m?.ordem === 'number' ? m.ordem : i,
      }
    })
    .filter((m): m is NonNullable<typeof m> => {
      if (!m) return false
      if (vistos.has(m.modalityKey)) return false
      vistos.add(m.modalityKey)
      return true
    })

  if (modalidades.length === 0) return NextResponse.json({ error: 'Inclua ao menos uma modalidade.' }, { status: 400 })

  const existe = await prisma.catalogoPais.findUnique({ where: { countryKey } })
  if (existe) return NextResponse.json({ error: `Já existe um país com a chave "${countryKey}".` }, { status: 409 })

  try {
    const pais = await prisma.$transaction(async (tx) => {
      const p = await tx.catalogoPais.create({
        data: {
          countryKey,
          countryLabel,
          nationalityKey,
          nationalityLabel,
          flag: body?.flag ? String(body.flag).trim() : null,
          codePrefix: body?.codePrefix ? String(body.codePrefix).trim() : null,
          defaultCurrency: String(body?.defaultCurrency || 'EUR').trim() || 'EUR',
          ativo: true,
        },
      })
      await tx.modalidadePais.createMany({
        data: modalidades.map((m) => ({
          countryKey,
          modalityKey: m.modalityKey,
          modalityLabel: m.modalityLabel,
          codeSuffix: m.codeSuffix ?? undefined, // createMany usa undefined (não null)
          ordem: m.ordem,
          ativo: true,
        })),
        skipDuplicates: true,
      })
      return p
    })

    return NextResponse.json({ pais }, { status: 201 })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Erro ao criar país.' }, { status: 500 })
  }
}