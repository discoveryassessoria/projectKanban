// /api/gerenciamento/adquirentes — CRUD de Adquirente/Gateway (entidade oficial).
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verificarPermissao } from '@/src/lib/verificar-permissao'
import { gerarCodigoPublico } from '@/lib/codigos/code-generator'

const str = (v: unknown, max = 120): string | null => { if (v == null) return null; const s = String(v).trim(); return s === '' ? null : s.slice(0, max) }
const slug = (v: unknown): string => String(v ?? '').trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '')
const listaInt = (v: unknown): number[] => (Array.isArray(v) ? v.map((x) => Math.trunc(Number(x))).filter((n) => Number.isFinite(n)) : [])
const dataOu = (v: unknown): Date | null => { if (!v) return null; const d = new Date(String(v)); return isNaN(d.getTime()) ? null : d }

export async function GET(req: NextRequest) {
  const erro = await verificarPermissao(req, 'usuarios.gerenciar'); if (erro) return erro
  const adquirentes = await prisma.adquirente.findMany({ orderBy: [{ ativo: 'desc' }, { nome: 'asc' }] })
  const formas = await prisma.formaPagamentoCadastro.findMany({ where: { ativo: true }, select: { id: true, name: true }, orderBy: { name: 'asc' } })
  return NextResponse.json({ adquirentes, formas })
}

export async function POST(req: NextRequest) {
  const erro = await verificarPermissao(req, 'usuarios.gerenciar'); if (erro) return erro
  const b = await req.json().catch(() => ({}))
  if (!b.nome || !String(b.nome).trim()) return NextResponse.json({ error: 'Informe o nome.' }, { status: 400 })
  const s = b.slug ? slug(b.slug) : slug(b.nome)
  if (!s) return NextResponse.json({ error: 'Slug inválido.' }, { status: 400 })
  const existe = await prisma.adquirente.findUnique({ where: { slug: s } })
  if (existe) return NextResponse.json({ error: `Já existe adquirente com slug ${s}.`, codigo: 'DUPLICADO' }, { status: 409 })
  try {
    const adquirente = await prisma.$transaction(async (tx) => {
      const code = await gerarCodigoPublico(tx, 'ACQUIRER')
      return tx.adquirente.create({ data: {
        code, slug: s, nome: String(b.nome).trim().slice(0, 120), ativo: b.ativo === undefined ? true : !!b.ativo,
        formasSuportadas: listaInt(b.formasSuportadas), vigenciaInicio: dataOu(b.vigenciaInicio), vigenciaFim: dataOu(b.vigenciaFim),
        identificadorExterno: str(b.identificadorExterno), metadados: b.metadados ?? undefined,
      } })
    })
    return NextResponse.json({ adquirente })
  } catch (e) { console.error('Erro ao criar adquirente:', e); return NextResponse.json({ error: 'Erro interno' }, { status: 500 }) }
}
