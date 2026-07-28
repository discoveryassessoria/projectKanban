// /api/financeiro/v3/obrigacoes/[id]/estado — F4.3: muda o estado de negócio do custo
//   POST { estado } → transição validada pela máquina (Aprovar/Contratar/Executar…),
//   transacional e auditada (LogAuditoria ESTADO_CUSTO). Só custo. Gated por posicaoRead.
//   (A segregação de funções — quem pode aprovar/pagar/conciliar — é entrega de F6.)
import { NextRequest, NextResponse } from 'next/server'
import { verificarPermissao, extrairUsuarioComPermissoes } from '@/src/lib/verificar-permissao'
import { flagAtiva } from '@/lib/financeiro/flags'
import { mudarEstadoCusto } from '@/lib/financeiro/acoes/estado-custo-service'
import { ehEstadoCusto } from '@/lib/financeiro/dominio/estado-custo'
import { usuarioFlag } from '../../../_flags'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const erro = await verificarPermissao(req, 'financeiro.ver'); if (erro) return erro
  if (!flagAtiva('posicaoRead', await usuarioFlag(req))) {
    return NextResponse.json({ ok: false, motivo: 'Financeiro V3 não habilitado neste ambiente/usuário.' }, { status: 409 })
  }
  const id = Number((await params).id)
  if (!id) return NextResponse.json({ ok: false, erro: 'id inválido.' }, { status: 400 })
  const b = await req.json().catch(() => ({}))
  const estado = String(b?.estado ?? '').toUpperCase()
  if (!ehEstadoCusto(estado)) return NextResponse.json({ ok: false, erro: 'Estado inválido.' }, { status: 400 })
  const actor = await extrairUsuarioComPermissoes(req)
  try {
    const r = await mudarEstadoCusto(String(id), estado, { usuarioId: actor?.userId ?? null, motivo: b?.motivo ?? null })
    if (!r.ok) return NextResponse.json({ ...r, erro: r.erro ?? 'Transição inválida.' }, { status: 422 })
    return NextResponse.json({ ...r })
  } catch (e) {
    return NextResponse.json({ ok: false, erro: e instanceof Error ? e.message : 'Falha ao mudar o estado.' }, { status: 422 })
  }
}
