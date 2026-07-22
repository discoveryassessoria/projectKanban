// /api/gerenciamento/bandeiras — CRUD de Bandeira de cartão (entidade oficial).
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verificarPermissao } from '@/src/lib/verificar-permissao'
import { gerarCodigoPublico } from '@/lib/codigos/code-generator'

const slug = (v: unknown): string => String(v ?? '').trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '')
const listaInt = (v: unknown): number[] => (Array.isArray(v) ? v.map((x) => Math.trunc(Number(x))).filter((n) => Number.isFinite(n)) : [])

export async function GET(req: NextRequest) {
  const erro = await verificarPermissao(req, 'usuarios.gerenciar'); if (erro) return erro
  const [bandeiras, adquirentes] = await Promise.all([
    prisma.bandeira.findMany({ orderBy: [{ ativo: 'desc' }, { nome: 'asc' }] }),
    prisma.adquirente.findMany({ where: { ativo: true }, select: { id: true, nome: true }, orderBy: { nome: 'asc' } }),
  ])
  return NextResponse.json({ bandeiras, adquirentes })
}

export async function POST(req: NextRequest) {
  const erro = await verificarPermissao(req, 'usuarios.gerenciar'); if (erro) return erro
  const b = await req.json().catch(() => ({}))
  if (!b.nome || !String(b.nome).trim()) return NextResponse.json({ error: 'Informe o nome.' }, { status: 400 })
  const s = b.slug ? slug(b.slug) : slug(b.nome)
  if (!s) return NextResponse.json({ error: 'Slug inválido.' }, { status: 400 })
  const existe = await prisma.bandeira.findUnique({ where: { slug: s } })
  if (existe) return NextResponse.json({ error: `Já existe bandeira com slug ${s}.`, codigo: 'DUPLICADO' }, { status: 409 })
  try {
    const bandeira = await prisma.$transaction(async (tx) => {
      const code = await gerarCodigoPublico(tx, 'CARD_BRAND')
      return tx.bandeira.create({ data: {
        code, slug: s, nome: String(b.nome).trim().slice(0, 60), ativo: b.ativo === undefined ? true : !!b.ativo,
        adquirentesCompativeis: listaInt(b.adquirentesCompativeis),
      } })
    })
    return NextResponse.json({ bandeira })
  } catch (e) { console.error('Erro ao criar bandeira:', e); return NextResponse.json({ error: 'Erro interno' }, { status: 500 }) }
}
