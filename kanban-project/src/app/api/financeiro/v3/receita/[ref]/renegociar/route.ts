// /api/financeiro/v3/receita/[ref]/renegociar — POST · Renegociar (Mais Ações).
// Atua SOMENTE sobre cobranças ABERTAS/PARCIAIS (nunca sobre pagamentos
// confirmados). Body { novaData?, observacao? }. Marca como RENEGOCIADA e audita.
import { NextRequest, NextResponse } from 'next/server'
import { verificarPermissao, extrairUsuarioComPermissoes } from '@/src/lib/verificar-permissao'
import { flagAtiva } from '@/lib/financeiro/flags'
import { usuarioFlag } from '@/src/app/api/financeiro/v3/_flags'
import { renegociar } from '@/lib/financeiro/acoes/renegociar'
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
    const r = await renegociar(ref, { novaData: b?.novaData ?? null, observacao: b?.observacao ?? null }, { usuarioId: actor?.userId ?? null })
    return NextResponse.json({ ok: true, ...r })
  } catch (e) {
    if (e instanceof AcaoReceitaError) return NextResponse.json({ ok: false, erro: e.message }, { status: e.status })
    return NextResponse.json({ ok: false, erro: e instanceof Error ? e.message : 'Falha ao renegociar.' }, { status: 422 })
  }
}
