// /api/financeiro/v3/obrigacoes/[id]/documentos — Documentos vinculados a uma
// Obrigação (fonte única por obrigacaoId, cobre RECEITA e CUSTO).
//   GET  → lista os documentos da obrigação (mais recentes primeiro)
//   POST → vincula um documento já enviado ao storage (arquivoUrl/arquivoNome).
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verificarPermissao, extrairUsuarioComPermissoes } from '@/src/lib/verificar-permissao'
import { flagAtiva } from '@/lib/financeiro/flags'
import { usuarioFlag } from '../../../_flags'

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const erro = await verificarPermissao(req, 'financeiro.ver'); if (erro) return erro
  if (!flagAtiva('posicaoRead', await usuarioFlag(req))) {
    return NextResponse.json({ ok: false, motivo: 'Financeiro V3 não habilitado neste ambiente/usuário.' }, { status: 409 })
  }
  const id = Number((await params).id)
  const rows = await prisma.receitaDocumento.findMany({
    where: { obrigacaoId: id }, orderBy: { criadoEm: 'desc' },
  })
  const documentos = rows.map((r) => ({
    id: r.id, nome: r.arquivoNome, tipo: r.tipo, url: r.arquivoUrl, tamanho: r.tamanho,
    criadoEm: r.criadoEm.toISOString(),
  }))
  return NextResponse.json({ documentos })
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const erro = await verificarPermissao(req, 'financeiro.ver'); if (erro) return erro
  if (!flagAtiva('posicaoRead', await usuarioFlag(req))) {
    return NextResponse.json({ ok: false, motivo: 'Financeiro V3 não habilitado neste ambiente/usuário.' }, { status: 409 })
  }
  const id = Number((await params).id)
  const b = await req.json().catch(() => ({}))
  const arquivoUrl = b.arquivoUrl ? String(b.arquivoUrl) : ''
  const arquivoNome = b.arquivoNome ? String(b.arquivoNome) : ''
  if (!arquivoUrl || !arquivoNome) {
    return NextResponse.json({ error: 'arquivoUrl e arquivoNome são obrigatórios.' }, { status: 400 })
  }
  const usuario = await extrairUsuarioComPermissoes(req)
  const actorId = usuario?.userId ?? null
  try {
    const doc = await prisma.receitaDocumento.create({
      data: {
        obrigacaoId: id,
        receitaId: null,
        arquivoUrl, arquivoNome,
        tipo: b.tipo != null ? String(b.tipo) : null,
        tamanho: b.tamanho != null ? Number(b.tamanho) : null,
        criadoPorId: actorId,
      },
    })
    return NextResponse.json({
      ok: true,
      documento: {
        id: doc.id, nome: doc.arquivoNome, tipo: doc.tipo, url: doc.arquivoUrl,
        tamanho: doc.tamanho, criadoEm: doc.criadoEm.toISOString(),
      },
    })
  } catch (e) {
    return NextResponse.json({ error: (e as Error)?.message || 'Falha ao vincular documento.' }, { status: 422 })
  }
}
