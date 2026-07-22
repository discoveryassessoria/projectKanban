import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verificarPermissao } from '@/src/lib/verificar-permissao'
import { registrarAuditoria } from '@/lib/gerenciamento/auditoria'

const listaInt = (v: unknown): number[] => (Array.isArray(v) ? v.map((x) => Math.trunc(Number(x))).filter((n) => Number.isFinite(n)) : [])

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const erro = await verificarPermissao(req, 'usuarios.gerenciar'); if (erro) return erro
  const id = Number((await params).id)
  const atual = await prisma.bandeira.findUnique({ where: { id } })
  if (!atual) return NextResponse.json({ error: 'Bandeira não encontrada' }, { status: 404 })
  const b = await req.json().catch(() => ({}))
  const bandeira = await prisma.bandeira.update({ where: { id }, data: {
    nome: b.nome !== undefined ? String(b.nome).trim().slice(0, 60) : atual.nome,
    ativo: b.ativo !== undefined ? !!b.ativo : atual.ativo,
    adquirentesCompativeis: b.adquirentesCompativeis !== undefined ? listaInt(b.adquirentesCompativeis) : atual.adquirentesCompativeis,
  } })
  return NextResponse.json({ bandeira })
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const erro = await verificarPermissao(req, 'usuarios.gerenciar'); if (erro) return erro
  const id = Number((await params).id)
  const emUso = await prisma.taxaPagamento.count({ where: { bandeiraId: id } })
  if (emUso > 0) return NextResponse.json({ error: 'Bandeira em uso por taxa(s) — desative em vez de excluir.', codigo: 'EM_USO' }, { status: 409 })
  await registrarAuditoria(req, { acao: 'EXCLUIR', entidade: 'Bandeira', entidadeId: id, descricao: `Bandeira excluída (#${id})` })
  await prisma.bandeira.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
