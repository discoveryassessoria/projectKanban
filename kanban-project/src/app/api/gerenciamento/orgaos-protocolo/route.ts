// src/app/api/gerenciamento/orgaos-protocolo/route.ts
// Cadastro mestre de Órgãos e Organizações (Gerenciamento › Órgãos e Organizações).
// O código público (ORG1, ORG2…) é gerado pelo CodeGeneratorService no create e
// NUNCA aceito do cliente. Categorias são N:N (uma entidade pode ser cartório E
// tradutor). Anti-duplicidade por nome oficial + país.

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verificarPermissao } from '@/src/lib/verificar-permissao'

const INCLUDE_CATEGORIAS = {
  categorias: { select: { categoriaId: true, categoria: { select: { id: true, code: true, nome: true, ativo: true } } } },
} as const

const s = (v: unknown, max?: number) => {
  if (typeof v !== 'string') return null
  const t = v.trim()
  if (!t) return null
  return max ? t.slice(0, max) : t
}
const listaTags = (v: unknown): string[] =>
  Array.isArray(v) ? Array.from(new Set(v.map((x) => String(x).trim()).filter(Boolean))) : []

/** Campos livres da ficha — mesmos no POST e no PUT. */
function camposDaFicha(b: Record<string, unknown>) {
  return {
    nomeFantasia: s(b.nomeFantasia, 200),
    type: s(b.type, 30),
    country: s(b.country, 60),
    state: s(b.state, 60),
    city: s(b.city, 100),
    endereco: s(b.endereco, 300),
    cep: s(b.cep, 20),
    site: s(b.site, 300),
    email: s(b.email, 200),
    telefone: s(b.telefone, 60),
    idioma: s(b.idioma, 10),
    moeda: s(b.moeda, 10),
    horario: s(b.horario, 200),
    responsavel: s(b.responsavel, 200),
    observacoes: s(b.observacoes),
    queueRule: s(b.queueRule, 200),
    tags: listaTags(b.tags),
  }
}

export async function GET(request: NextRequest) {
  const erro = await verificarPermissao(request, 'usuarios.gerenciar')
  if (erro) return erro
  try {
    const orgaos = await prisma.orgaoProtocolo.findMany({
      orderBy: [{ country: 'asc' }, { name: 'asc' }],
      include: INCLUDE_CATEGORIAS,
    })
    return NextResponse.json({ orgaos })
  } catch (e) {
    console.error('GET orgaos-protocolo', e)
    return NextResponse.json({ error: 'Erro ao carregar órgãos.' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const erro = await verificarPermissao(request, 'usuarios.gerenciar')
  if (erro) return erro
  try {
    const b = await request.json()
    const name = s(b.name, 200)
    if (!name) return NextResponse.json({ error: 'Informe o nome oficial.' }, { status: 400 })

    const ficha = camposDaFicha(b)
    // Anti-duplicidade: mesma entidade (nome oficial + país) não entra duas vezes.
    const jaExiste = await prisma.orgaoProtocolo.findFirst({
      where: { name, country: ficha.country },
      select: { id: true, publicCode: true },
    })
    if (jaExiste) {
      return NextResponse.json(
        { error: `Já existe uma organização com este nome neste país (${jaExiste.publicCode ?? `#${jaExiste.id}`}).` },
        { status: 409 },
      )
    }

    const categoriaIds: number[] = Array.isArray(b.categoriaIds)
      ? Array.from(new Set(b.categoriaIds.map(Number).filter((n: number) => Number.isInteger(n))))
      : []

    const orgao = await prisma.$transaction(async (tx) => {
      const criado = await tx.orgaoProtocolo.create({
        data: { name, ...ficha, ativo: b.ativo !== false },
      })
      if (categoriaIds.length) {
        await tx.organizacaoCategoria.createMany({
          data: categoriaIds.map((categoriaId) => ({ orgaoId: criado.id, categoriaId })),
          skipDuplicates: true,
        })
      }
      return tx.orgaoProtocolo.findUnique({ where: { id: criado.id }, include: INCLUDE_CATEGORIAS })
    })

    return NextResponse.json({ orgao }, { status: 201 })
  } catch (e) {
    console.error('POST orgaos-protocolo', e)
    return NextResponse.json({ error: 'Erro ao criar órgão.' }, { status: 500 })
  }
}
