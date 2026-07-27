// /api/financeiro/v3/receita/[ref]/duplicar — POST
// Cria uma NOVA Receita/Obrigação a partir da origem (mesmo item/valor/moeda/câmbio/
// distribuição/participantes), SEM pagamentos/cobranças/ledger da origem.
// Body { vencimentoEmDias? } (default: vencimento null). Retorna { obrigacaoId }.
import { NextRequest, NextResponse } from 'next/server'
import { verificarPermissao, extrairUsuarioComPermissoes } from '@/src/lib/verificar-permissao'
import { flagAtiva } from '@/lib/financeiro/flags'
import { usuarioFlag } from '../../../_flags'
import { duplicarReceita } from '@/lib/financeiro/acoes/duplicar-receita'
import { AcaoReceitaError } from '@/lib/financeiro/acoes/recibo'

export async function POST(req: NextRequest, { params }: { params: Promise<{ ref: string }> }) {
  const erro = await verificarPermissao(req, 'financeiro.ver'); if (erro) return erro
  const u = await usuarioFlag(req)
  if (!flagAtiva('posicaoRead', u) && !flagAtiva('ocorrencias', u)) {
    return NextResponse.json({ ok: false, erro: 'Duplicação V3 não habilitada neste ambiente/usuário.' }, { status: 409 })
  }
  const { ref } = await params
  const b = await req.json().catch(() => ({} as Record<string, unknown>))
  const actor = await extrairUsuarioComPermissoes(req)
  try {
    const r = await duplicarReceita(ref, { usuarioId: actor?.userId ?? null, vencimentoEmDias: b?.vencimentoEmDias == null ? null : Number(b.vencimentoEmDias) })
    return NextResponse.json({ ok: true, ...r })
  } catch (e) {
    if (e instanceof AcaoReceitaError) return NextResponse.json({ ok: false, erro: e.message }, { status: e.status })
    return NextResponse.json({ ok: false, erro: e instanceof Error ? e.message : 'Falha ao duplicar receita.' }, { status: 422 })
  }
}
