// /api/financeiro/v3/receita/[ref]/excluir
//   GET ?check=1 → { permitido, motivos } (checa sem excluir)
//   DELETE       → exclusão LÓGICA (só se podeExcluir; 422 com motivos se bloqueado)
// Flag-gated (posicaoRead|ocorrencias). Ledger/histórico NUNCA são apagados.
import { NextRequest, NextResponse } from 'next/server'
import { verificarPermissao, extrairUsuarioComPermissoes } from '@/src/lib/verificar-permissao'
import { flagAtiva } from '@/lib/financeiro/flags'
import { usuarioFlag } from '../../../_flags'
import { podeExcluir, excluirReceita } from '@/lib/financeiro/acoes/excluir-receita'
import { AcaoReceitaError } from '@/lib/financeiro/acoes/recibo'

async function guard(req: NextRequest) {
  const erro = await verificarPermissao(req, 'financeiro.ver'); if (erro) return erro
  const u = await usuarioFlag(req)
  if (!flagAtiva('posicaoRead', u) && !flagAtiva('ocorrencias', u)) {
    return NextResponse.json({ ok: false, erro: 'Exclusão V3 não habilitada neste ambiente/usuário.' }, { status: 409 })
  }
  return null
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ ref: string }> }) {
  const bloqueio = await guard(req); if (bloqueio) return bloqueio
  const { ref } = await params
  try {
    const r = await podeExcluir(ref)
    return NextResponse.json({ ok: true, ...r })
  } catch (e) {
    if (e instanceof AcaoReceitaError) return NextResponse.json({ ok: false, erro: e.message }, { status: e.status })
    return NextResponse.json({ ok: false, erro: e instanceof Error ? e.message : 'Falha ao checar exclusão.' }, { status: 422 })
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ ref: string }> }) {
  const bloqueio = await guard(req); if (bloqueio) return bloqueio
  const { ref } = await params
  const b = await req.json().catch(() => ({} as Record<string, unknown>))
  const actor = await extrairUsuarioComPermissoes(req)
  try {
    const r = await excluirReceita(ref, { usuarioId: actor?.userId ?? null, motivo: typeof b?.motivo === 'string' ? b.motivo : null })
    return NextResponse.json({ ok: true, ...r })
  } catch (e) {
    if (e instanceof AcaoReceitaError) return NextResponse.json({ ok: false, erro: e.message, motivos: e.motivos ?? [] }, { status: e.status })
    return NextResponse.json({ ok: false, erro: e instanceof Error ? e.message : 'Falha ao excluir.' }, { status: 422 })
  }
}
