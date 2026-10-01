// /api/torre/metas — METAS DE TEMPO POR FASE E POR PAÍS (Torre nova, Etapa A · M1). SOMENTE EXIBIÇÃO.
//   GET     as metas + as fases do Catálogo (ativas) + os países, para o cartão do Gerenciamento.
//   PUT     { phaseKey, paisId?: number|null, metaDias, ativo? } — cria ou atualiza a meta do par (fase, país).
//   DELETE  ?id=  — exclui a meta.
// A régua é a da tela de Saúde do sistema (`usuarios.gerenciar`). Toda escrita grava histórico (LogAuditoria).
import { type NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { exigirGerenciamento } from '@/src/lib/torre-acesso'
import { definirMeta, excluirMeta, listarMetas } from '@/lib/operacional/torre-metas'

export async function GET(request: NextRequest) {
  const { erro } = await exigirGerenciamento(request)
  if (erro) return erro
  const [metas, fases, paises] = await Promise.all([
    listarMetas(),
    prisma.catalogoFase.findMany({ where: { ativo: true }, orderBy: [{ ordemPadrao: 'asc' }, { id: 'asc' }], select: { phaseKey: true, label: true } }),
    prisma.catalogoPais.findMany({ where: { ativo: true }, orderBy: { countryLabel: 'asc' }, select: { id: true, countryLabel: true, flag: true } }),
  ])
  return NextResponse.json({ metas, fases, paises })
}

export async function PUT(request: NextRequest) {
  const { usuario, erro } = await exigirGerenciamento(request)
  if (erro) return erro
  const b = await request.json().catch(() => ({}))
  const paisId = b?.paisId == null || b.paisId === '' ? null : Number(b.paisId)
  if (paisId != null && !Number.isInteger(paisId)) return NextResponse.json({ error: 'paisId inválido' }, { status: 400 })
  const r = await definirMeta({
    phaseKey: String(b?.phaseKey ?? ''), paisId, metaDias: typeof b?.metaDias === 'number' ? b.metaDias : Number(b?.metaDias),
    ativo: typeof b?.ativo === 'boolean' ? b.ativo : undefined, autorId: usuario.userId,
  })
  return NextResponse.json(r, { status: r.ok ? 200 : 422 })
}

export async function DELETE(request: NextRequest) {
  const { usuario, erro } = await exigirGerenciamento(request)
  if (erro) return erro
  const id = Number(new URL(request.url).searchParams.get('id'))
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: 'id inválido' }, { status: 400 })
  const r = await excluirMeta(id, usuario.userId)
  return NextResponse.json(r, { status: r.ok ? 200 : 404 })
}
