// /api/financeiro/v3/obrigacoes/[id]/reprovar — F7.2: REPROVAR um custo em análise.
//   POST { motivo } → recusa auditável do custo (permissão própria financeiro.custo_reprovar,
//   motivo obrigatório, LogAuditoria REPROVAR). Encerra a obrigação pelo motor único
//   (cancelarObrigacao) — não cria estado novo. Só custo. Gated por posicaoRead.
import { NextRequest, NextResponse } from 'next/server'
import { verificarPermissao, extrairUsuarioComPermissoes } from '@/src/lib/verificar-permissao'
import { flagAtiva } from '@/lib/financeiro/flags'
import { reprovarCusto } from '@/lib/financeiro/acoes/reprovar-custo'
import { verificarPermissaoCustoDaObrigacao } from '@/lib/financeiro/permissoes-custo'
import { registrarAuditoria } from '@/lib/gerenciamento/auditoria'
import { usuarioFlag } from '../../../_flags'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const erro = await verificarPermissao(req, 'financeiro.ver'); if (erro) return erro
  if (!flagAtiva('posicaoRead', await usuarioFlag(req))) {
    return NextResponse.json({ ok: false, motivo: 'Financeiro V3 não habilitado neste ambiente/usuário.' }, { status: 409 })
  }
  const id = Number((await params).id)
  if (!id) return NextResponse.json({ ok: false, erro: 'id inválido.' }, { status: 400 })
  // F6 — segregação: reprovar é permissão PRÓPRIA (quem aprova não necessariamente reprova).
  const gCusto = await verificarPermissaoCustoDaObrigacao(req, 'reprovar', id); if (gCusto) return gCusto
  const b = await req.json().catch(() => ({}))
  const actor = await extrairUsuarioComPermissoes(req)
  try {
    const r = await reprovarCusto(id, { motivo: String(b?.motivo ?? ''), usuarioId: actor?.userId ?? null })
    if (!r.ok) return NextResponse.json(r, { status: 422 })
    await registrarAuditoria(req, {
      acao: 'DESATIVAR', entidade: 'LancamentoFinanceiro', entidadeId: id,
      descricao: `Custo reprovado: ${String(b?.motivo ?? '').trim()}`,
      detalhes: { obrigacaoId: id, reprovacao: true, de: r.de ?? null, jaReprovado: !!r.jaReprovado },
    })
    return NextResponse.json(r)
  } catch (e) {
    return NextResponse.json({ ok: false, erro: e instanceof Error ? e.message : 'Falha ao reprovar.' }, { status: 422 })
  }
}
