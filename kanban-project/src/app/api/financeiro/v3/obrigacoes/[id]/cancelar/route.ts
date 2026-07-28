// /api/financeiro/v3/obrigacoes/[id]/cancelar — cancelamento auditável.
//   POST { motivo? } → estorna o Ledger (zera saldo), status CANCELADO, sem
//   apagar histórico. Gated por posicaoRead. Auditoria registrada.
import { NextRequest, NextResponse } from 'next/server'
import { verificarPermissao, extrairUsuarioComPermissoes } from '@/src/lib/verificar-permissao'
import { flagAtiva } from '@/lib/financeiro/flags'
import { cancelarObrigacao } from '@/lib/financeiro/extras/cancelar-lancamento'
import { registrarAuditoria } from '@/lib/gerenciamento/auditoria'
import { verificarPermissaoCustoDaObrigacao } from '@/lib/financeiro/permissoes-custo'
import { usuarioFlag } from '../../../_flags'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const erro = await verificarPermissao(req, 'financeiro.ver'); if (erro) return erro
  if (!flagAtiva('posicaoRead', await usuarioFlag(req))) {
    return NextResponse.json({ ok: false, motivo: 'Financeiro V3 não habilitado neste ambiente/usuário.' }, { status: 409 })
  }
  const id = Number((await params).id)
  if (!id) return NextResponse.json({ ok: false, erro: 'id inválido.' }, { status: 400 })
  // F6 — segregação: cancelar custo exige financeiro.custo_cancelar (natureza-aware).
  const gCusto = await verificarPermissaoCustoDaObrigacao(req, 'cancelar', id); if (gCusto) return gCusto
  const b = await req.json().catch(() => ({}))
  const actor = await extrairUsuarioComPermissoes(req)
  try {
    const r = await cancelarObrigacao({ obrigacaoId: id, motivo: b?.motivo ?? null, criadoPorId: actor?.userId ?? null })
    await registrarAuditoria(req, { acao: 'DESATIVAR', entidade: 'LancamentoFinanceiro', entidadeId: id, descricao: `Lançamento cancelado${b?.motivo ? `: ${b.motivo}` : ''}`, detalhes: { obrigacaoId: id, jaCancelada: r.jaCancelada } })
    return NextResponse.json({ ok: true, ...r })
  } catch (e) {
    return NextResponse.json({ ok: false, erro: e instanceof Error ? e.message : 'Falha ao cancelar.' }, { status: 422 })
  }
}
