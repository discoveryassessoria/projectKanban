// /api/financeiro/v3/receita/[ref]/cancelar — POST · Cancelar Receita (Mais Ações).
// Marca cancelada=true/status=CANCELADA SEM apagar cobranças/pagamentos/ledger.
// Bloqueia (409) se houver pagamento confirmado sem estorno prévio. Body { motivo? }.
import { NextRequest, NextResponse } from 'next/server'
import { verificarPermissao, extrairUsuarioComPermissoes } from '@/src/lib/verificar-permissao'
import { flagAtiva } from '@/lib/financeiro/flags'
import { usuarioFlag } from '@/src/app/api/financeiro/v3/_flags'
import { cancelarReceita } from '@/lib/financeiro/acoes/cancelar'
import { AcaoReceitaError } from '@/lib/financeiro/acoes/recibo'

export async function POST(req: NextRequest, { params }: { params: Promise<{ ref: string }> }) {
  const erro = await verificarPermissao(req, 'financeiro.ver'); if (erro) return erro
  const u = await usuarioFlag(req)
  if (!flagAtiva('posicaoRead', u) && !flagAtiva('ocorrencias', u)) {
    return NextResponse.json({ ok: false, motivo: 'Ações da Receita V3 não habilitadas neste ambiente/usuário.' }, { status: 409 })
  }
  const { ref } = await params
  const b = await req.json().catch(() => ({}))
  const actor = await extrairUsuarioComPermissoes(req)
  try {
    const r = await cancelarReceita(ref, { motivo: b?.motivo ?? null }, { usuarioId: actor?.userId ?? null })
    return NextResponse.json({ ok: true, ...r })
  } catch (e) {
    if (e instanceof AcaoReceitaError) return NextResponse.json({ ok: false, erro: e.message }, { status: e.status })
    return NextResponse.json({ ok: false, erro: e instanceof Error ? e.message : 'Falha ao cancelar receita.' }, { status: 422 })
  }
}
