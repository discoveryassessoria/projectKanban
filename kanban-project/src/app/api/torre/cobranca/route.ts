// GET /api/torre/cobranca → o prazo do «cobrar a partir de» (dias ÚTEIS): o padrão e os ajustes por cartório.
// PUT /api/torre/cobranca { padraoDias } | { orgaoId, dias | null } → grava (auditado). É só um lembrete: não trava nada.
import { type NextRequest, NextResponse } from 'next/server'
import { exigirGerenciamento } from '@/src/lib/torre-acesso'
import { prisma } from '@/lib/prisma'
import { COBRANCA_UTEIS_VIGENTE_DESDE, definirDiasDoOrgao, definirDiasPadraoDaCobranca, lerConfigDeCobranca } from '@/lib/operacional/cobranca-uteis'

export async function GET(request: NextRequest) {
  const { erro } = await exigirGerenciamento(request, 'usuarios.gerenciar')
  if (erro) return erro
  const cfg = await lerConfigDeCobranca()
  const ids = Object.keys(cfg.porOrgao).map(Number)
  const orgaos = ids.length ? await prisma.orgaoProtocolo.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }) : []
  const todos = await prisma.orgaoProtocolo.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' }, take: 2000 })
  return NextResponse.json({
    padraoDias: cfg.padraoDias, vigenteDesde: COBRANCA_UTEIS_VIGENTE_DESDE.toISOString(),
    porOrgao: orgaos.map((o) => ({ orgaoId: o.id, nome: o.name, dias: cfg.porOrgao[o.id] })),
    orgaos: todos,
  })
}

export async function PUT(request: NextRequest) {
  const { erro, usuario } = await exigirGerenciamento(request, 'usuarios.gerenciar')
  if (erro) return erro
  const corpo = (await request.json().catch(() => ({}))) as { padraoDias?: unknown; orgaoId?: unknown; dias?: unknown }
  const autorId = (usuario as { userId?: number } | undefined)?.userId ?? null
  const r = corpo.orgaoId !== undefined
    ? await definirDiasDoOrgao(Number(corpo.orgaoId), corpo.dias == null || corpo.dias === '' ? null : Number(corpo.dias), autorId)
    : await definirDiasPadraoDaCobranca(Number(corpo.padraoDias), autorId)
  return r.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: r.erro }, { status: 422 })
}
