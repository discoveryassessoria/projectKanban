// CANAIS OPERACIONAIS — cadastro. Acrescentar um canal deixa de exigir deploy.
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verificarPermissao, extrairUsuarioComPermissoes } from '@/src/lib/verificar-permissao'

function slug(s: string) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toUpperCase().trim().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '')
}

export async function GET() {
  const canais = await prisma.canalOperacional.findMany({ orderBy: [{ ordem: 'asc' }, { id: 'asc' }] })
  return NextResponse.json({ canais })
}

export async function POST(request: NextRequest) {
  const erro = await verificarPermissao(request, 'usuarios.gerenciar')
  if (erro) return erro
  const body = await request.json()
  const key = slug(body?.key || body?.label || '')
  if (!key) return NextResponse.json({ error: 'Informe o nome do canal.' }, { status: 400 })
  const existe = await prisma.canalOperacional.findUnique({ where: { key }, select: { id: true } })
  if (existe) return NextResponse.json({ error: `Já existe um canal com a chave ${key}.` }, { status: 409 })

  const ultimo = await prisma.canalOperacional.findFirst({ orderBy: { ordem: 'desc' }, select: { ordem: true } })
  const canal = await prisma.canalOperacional.create({
    data: {
      key, label: String(body?.label || key),
      descricao: body?.descricao ? String(body.descricao) : null,
      ordem: Number(body?.ordem) || (ultimo?.ordem ?? 0) + 1,
      ativo: body?.ativo !== false,
      protocoloObrigatorio: !!body?.protocoloObrigatorio,
      anexoObrigatorioLabel: body?.anexoObrigatorioLabel ? String(body.anexoObrigatorioLabel) : null,
      rastreioObrigatorio: !!body?.rastreioObrigatorio,
      observacaoObrigatoria: !!body?.observacaoObrigatoria,
      aplicacao: body?.aplicacao ?? undefined,
    },
  })
  const u = await extrairUsuarioComPermissoes(request)
  await prisma.logAuditoria.create({
    data: {
      acao: 'CANAL_CRIADO', entidade: 'CanalOperacional', entidadeId: canal.id,
      descricao: `Canal "${canal.label}" cadastrado. Passa a ser oferecido nas versões publicadas a partir de agora.`,
      usuarioId: u?.userId ?? null,
    },
  }).catch(() => null)
  return NextResponse.json({ canal })
}

export async function PUT(request: NextRequest) {
  const erro = await verificarPermissao(request, 'usuarios.gerenciar')
  if (erro) return erro
  const body = await request.json()
  const id = Number(body?.id)
  if (!id) return NextResponse.json({ error: 'Canal não informado.' }, { status: 400 })
  const dados: Record<string, unknown> = {}
  for (const c of ['label', 'descricao', 'anexoObrigatorioLabel'] as const) {
    if (body[c] !== undefined) dados[c] = body[c] === null ? null : String(body[c])
  }
  for (const b of ['ativo', 'protocoloObrigatorio', 'rastreioObrigatorio', 'observacaoObrigatoria'] as const) {
    if (body[b] !== undefined) dados[b] = !!body[b]
  }
  if (body.ordem !== undefined) dados.ordem = Number(body.ordem) || 0
  if (body.aplicacao !== undefined) dados.aplicacao = body.aplicacao
  // A CHAVE NÃO MUDA. Ela é a identidade que as solicitações já gravadas referenciam;
  // renomear o rótulo é livre, trocar a chave apagaria o vínculo do histórico.
  const canal = await prisma.canalOperacional.update({ where: { id }, data: dados })
  return NextResponse.json({ canal })
}
