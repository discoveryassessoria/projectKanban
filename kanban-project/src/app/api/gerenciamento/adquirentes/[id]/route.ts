import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verificarPermissao } from '@/src/lib/verificar-permissao'
import { registrarAuditoria } from '@/lib/gerenciamento/auditoria'

const str = (v: unknown, max = 120): string | null => { if (v == null) return null; const s = String(v).trim(); return s === '' ? null : s.slice(0, max) }
const listaInt = (v: unknown): number[] => (Array.isArray(v) ? v.map((x) => Math.trunc(Number(x))).filter((n) => Number.isFinite(n)) : [])
const dataOu = (v: unknown): Date | null => { if (!v) return null; const d = new Date(String(v)); return isNaN(d.getTime()) ? null : d }

// PUT — atualiza (code e slug são IMUTÁVEIS; nunca regravados).
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const erro = await verificarPermissao(req, 'usuarios.gerenciar'); if (erro) return erro
  const id = Number((await params).id)
  const atual = await prisma.adquirente.findUnique({ where: { id } })
  if (!atual) return NextResponse.json({ error: 'Adquirente não encontrada' }, { status: 404 })
  const b = await req.json().catch(() => ({}))
  const adquirente = await prisma.adquirente.update({ where: { id }, data: {
    nome: b.nome !== undefined ? String(b.nome).trim().slice(0, 120) : atual.nome,
    ativo: b.ativo !== undefined ? !!b.ativo : atual.ativo,
    formasSuportadas: b.formasSuportadas !== undefined ? listaInt(b.formasSuportadas) : atual.formasSuportadas,
    vigenciaInicio: b.vigenciaInicio !== undefined ? dataOu(b.vigenciaInicio) : atual.vigenciaInicio,
    vigenciaFim: b.vigenciaFim !== undefined ? dataOu(b.vigenciaFim) : atual.vigenciaFim,
    identificadorExterno: b.identificadorExterno !== undefined ? str(b.identificadorExterno) : atual.identificadorExterno,
  } })
  return NextResponse.json({ adquirente })
}

// DELETE — bloqueia se alguma Taxa referencia a adquirente; prefira desativar.
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const erro = await verificarPermissao(req, 'usuarios.gerenciar'); if (erro) return erro
  const id = Number((await params).id)
  const emUso = await prisma.taxaPagamento.count({ where: { adquirenteId: id } })
  if (emUso > 0) return NextResponse.json({ error: 'Adquirente em uso por taxa(s) — desative em vez de excluir.', codigo: 'EM_USO' }, { status: 409 })
  await registrarAuditoria(req, { acao: 'EXCLUIR', entidade: 'Adquirente', entidadeId: id, descricao: `Adquirente excluída (#${id})` })
  await prisma.adquirente.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
