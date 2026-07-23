// /api/financeiro/v3/conciliacao — CONCILIAÇÃO BANCÁRIA (Motor V3 · Fase 3)
//   POST { importar?: LinhaExtrato[], conciliar?: true, aplicar?: true, toleranciaDias? }
// Flag-gated (conciliacao). Conciliar é dry-run por padrão (aplicar:true persiste).
import { NextRequest, NextResponse } from 'next/server'
import { verificarPermissao, extrairUsuarioComPermissoes } from '@/src/lib/verificar-permissao'
import { flagAtiva } from '@/lib/financeiro/flags'
import { importarExtrato, conciliarPendentes } from '@/lib/financeiro/conciliacao/conciliacao-service'
import { prisma } from '@/lib/prisma'
import { usuarioFlag } from '../_flags'

export async function GET(req: NextRequest) {
  const erro = await verificarPermissao(req, 'financeiro.ver'); if (erro) return erro
  if (!flagAtiva('conciliacao', await usuarioFlag(req))) return NextResponse.json({ disponivel: false }, { status: 409 })
  const status = req.nextUrl.searchParams.get('status') ?? undefined
  const linhas = await prisma.lancamentoBancario.findMany({ where: status ? { status } : {}, orderBy: { data: 'desc' }, take: 300 })
  const resumo = await prisma.lancamentoBancario.groupBy({ by: ['status'], _count: true }).catch(() => [])
  return NextResponse.json({ disponivel: true, linhas, resumo: Object.fromEntries((resumo as { status: string; _count: number }[]).map((r) => [r.status, r._count])) })
}

export async function POST(req: NextRequest) {
  const erro = await verificarPermissao(req, 'financeiro.ver'); if (erro) return erro
  if (!flagAtiva('conciliacao', await usuarioFlag(req))) {
    return NextResponse.json({ ok: false, motivo: 'Conciliação bancária V3 não habilitada neste ambiente/usuário.' }, { status: 409 })
  }
  const actor = await extrairUsuarioComPermissoes(req)
  const b = await req.json().catch(() => ({}))
  try {
    let importado
    if (Array.isArray(b?.importar) && b.importar.length) {
      importado = await importarExtrato(b.importar, { origem: b.origem ?? 'manual', criadoPorId: actor?.userId ?? null })
    }
    let conciliacao
    if (b?.conciliar === true || importado) {
      conciliacao = await conciliarPendentes({ toleranciaDias: b.toleranciaDias, aplicar: b.aplicar === true, criadoPorId: actor?.userId ?? null })
    }
    return NextResponse.json({ ok: true, importado, conciliacao })
  } catch (e) {
    return NextResponse.json({ ok: false, erro: e instanceof Error ? e.message : 'Falha na conciliação.' }, { status: 422 })
  }
}
