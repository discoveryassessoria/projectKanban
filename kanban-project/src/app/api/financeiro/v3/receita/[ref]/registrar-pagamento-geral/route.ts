// POST /api/financeiro/v3/receita/[ref]/registrar-pagamento-geral
// Pagamento GERAL da Receita: aplica uma ALOCAÇÃO explícita por participante
// (nunca assume um único participante). Flag-gated (posicaoRead). Aditivo.
import { NextRequest, NextResponse } from 'next/server'
import { verificarPermissao, extrairUsuarioComPermissoes } from '@/src/lib/verificar-permissao'
import { flagAtiva } from '@/lib/financeiro/flags'
import { usuarioFlag } from '../../../_flags'
import { registrarPagamentoGeral } from '@/lib/financeiro/pagamentos/registrar-pagamento-geral'

export async function POST(req: NextRequest, { params }: { params: Promise<{ ref: string }> }) {
  const erro = await verificarPermissao(req, 'financeiro.ver'); if (erro) return erro
  const u = await usuarioFlag(req)
  if (!flagAtiva('ocorrencias', u) && !flagAtiva('posicaoRead', u)) {
    return NextResponse.json({ ok: false, erro: 'Recebimento V3 não habilitado.' }, { status: 409 })
  }
  await params // ref é contextual; as obrigações-alvo vêm nas alocações
  const b = await req.json().catch(() => ({} as Record<string, unknown>))
  if (!Array.isArray(b?.alocacoes) || !Array.isArray(b?.formas)) {
    return NextResponse.json({ ok: false, erro: 'alocacoes e formas são obrigatórios.' }, { status: 400 })
  }
  // idempotência OBRIGATÓRIA (proteção contra duplo-clique/retry): a mesma chave não duplica.
  if (typeof b?.idempotencyKey !== 'string' || !b.idempotencyKey) {
    return NextResponse.json({ ok: false, erro: 'idempotencyKey é obrigatória (proteção contra duplicidade).' }, { status: 400 })
  }
  const actor = await extrairUsuarioComPermissoes(req)
  try {
    const r = await registrarPagamentoGeral({
      alocacoes: b.alocacoes, formas: b.formas, ajustes: b?.ajustes ?? null, pagador: b?.pagador ?? null,
      observacao: b?.observacao ?? null, idempotencyKey: b.idempotencyKey, criadoPorId: actor?.userId ?? null,
    })
    if (!r.ok) return NextResponse.json({ ok: false, erro: r.erros[0] ?? 'Falha.', erros: r.erros }, { status: 422 })
    return NextResponse.json({ ...r, ok: true })
  } catch (e) {
    return NextResponse.json({ ok: false, erro: e instanceof Error ? e.message : 'Falha ao registrar pagamento geral.' }, { status: 422 })
  }
}
