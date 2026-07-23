// /api/financeiro/v3/lancamentos-extras — cria um LANÇAMENTO EXTRA (Motor V3).
//   POST { natureza, valor, moeda?, processoId?, distribuicao?, ocorrenciaImediata? }
// Flag-gated (extras). Cria nova obrigação (natureza extra) + Ledger próprio.
import { NextRequest, NextResponse } from 'next/server'
import { verificarPermissao, extrairUsuarioComPermissoes } from '@/src/lib/verificar-permissao'
import { flagAtiva } from '@/lib/financeiro/flags'
import { criarLancamentoExtra } from '@/lib/financeiro/extras/lancamento-extra-service'
import { usuarioFlag } from '../_flags'

export async function POST(req: NextRequest) {
  const erro = await verificarPermissao(req, 'financeiro.ver'); if (erro) return erro
  const u = await usuarioFlag(req)
  if (!flagAtiva('extras', u)) {
    return NextResponse.json({ ok: false, motivo: 'Lançamentos extras V3 não habilitados neste ambiente/usuário.' }, { status: 409 })
  }
  const b = await req.json().catch(() => ({}))
  if (!b?.natureza || b?.valor == null) return NextResponse.json({ erro: 'natureza e valor são obrigatórios.' }, { status: 400 })

  const actor = await extrairUsuarioComPermissoes(req)
  try {
    const r = await criarLancamentoExtra({
      natureza: b.natureza, descricao: b.descricao ?? null, valor: Number(b.valor), moeda: b.moeda,
      processoId: b.processoId ?? null, faseId: b.faseId ?? null, clienteId: b.clienteId ?? null,
      vencimento: b.vencimento ? new Date(b.vencimento) : null,
      distribuicao: b.distribuicao ?? null, pagamento: b.pagamento ?? null,
      criadoPorId: actor?.userId ?? null,
    })
    return NextResponse.json({ ok: true, ...r })
  } catch (e) {
    return NextResponse.json({ ok: false, erro: e instanceof Error ? e.message : 'Falha ao criar lançamento extra.' }, { status: 422 })
  }
}
