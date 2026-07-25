// POST /api/financeiro/cobrancas/[id]/enviar — marca a Cobrança como ENVIADA
// ao cliente (estado auditável). NÃO entrega e-mail/WhatsApp (sem infra de
// entrega): apenas registra enviadaEm/enviadaPorId + auditoria (fail-safe).
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verificarPermissao } from '@/src/lib/verificar-permissao'
import { extrairUsuarioComPermissoes } from '@/src/lib/verificar-permissao'
import { registrarAuditoria } from '@/lib/gerenciamento/auditoria'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  // "Enviar" NÃO é mutação do motor financeiro (não toca ledger/parcela/ocorrência): só
  // marca Cobranca.enviadaEm + auditoria. Portanto NÃO é bloqueado pelo corte legado —
  // é a ação canônica de marcar envio, disponível mesmo com o kill-switch ligado.
  const erro = await verificarPermissao(req, 'financeiro.ver'); if (erro) return erro
  const id = Number((await params).id)
  try {
    const actor = await extrairUsuarioComPermissoes(req).catch(() => null)
    const enviadaEm = new Date()
    await prisma.cobranca.update({ where: { id }, data: { enviadaEm, enviadaPorId: actor?.userId ?? null } })
    try {
      await registrarAuditoria(req, { acao: 'ENVIAR' as never, entidade: 'COBRANCA', entidadeId: id, descricao: 'Cobrança marcada como enviada ao cliente.' })
    } catch { /* auditoria nunca bloqueia o envio */ }
    return NextResponse.json({ ok: true, enviadaEm: enviadaEm.toISOString() })
  } catch (e) {
    return NextResponse.json({ ok: false, erro: (e as Error)?.message ?? 'Falha ao enviar a cobrança.' }, { status: 422 })
  }
}
