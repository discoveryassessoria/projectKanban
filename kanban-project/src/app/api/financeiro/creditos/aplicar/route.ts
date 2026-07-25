// /api/financeiro/creditos/aplicar — APLICA crédito(s) numa obrigação alvo.
//   POST { creditoId?, valor, obrigacaoAlvoId, pessoaId?, processoId?, idempotencyKey? }
// Escrita transacional (credito-service). Gate igual às rotas V3 (posicaoRead).
import { NextRequest, NextResponse } from 'next/server'
import { verificarPermissao, extrairUsuarioComPermissoes } from '@/src/lib/verificar-permissao'
import { flagAtiva } from '@/lib/financeiro/flags'
import { aplicarCredito } from '@/lib/financeiro/creditos/credito-service'
import { usuarioFlag } from '../../v3/_flags'

export async function POST(req: NextRequest) {
  const erro = await verificarPermissao(req, 'financeiro.ver'); if (erro) return erro
  const u = await usuarioFlag(req)
  // Aplicar crédito é escrita no motor financeiro: mesmo gate das ocorrências V3.
  if (!flagAtiva('ocorrencias', u) && !flagAtiva('posicaoRead', u)) {
    return NextResponse.json({ ok: false, motivo: 'Créditos V3 não habilitados neste ambiente/usuário.' }, { status: 409 })
  }

  const b = await req.json().catch(() => ({}))
  if (!b?.obrigacaoAlvoId || b?.valor == null) {
    return NextResponse.json({ erro: 'obrigacaoAlvoId e valor são obrigatórios.' }, { status: 400 })
  }

  const actor = await extrairUsuarioComPermissoes(req)
  try {
    const r = await aplicarCredito({
      creditoId: b.creditoId != null ? Number(b.creditoId) : null,
      valor: Number(b.valor),
      obrigacaoAlvoId: Number(b.obrigacaoAlvoId),
      pessoaId: b.pessoaId != null ? Number(b.pessoaId) : null,
      processoId: b.processoId != null ? Number(b.processoId) : null,
      idempotencyKey: b.idempotencyKey ? String(b.idempotencyKey).slice(0, 110) : null,
      criadoPorId: actor?.userId ?? null,
    })
    return NextResponse.json({ ok: true, ...r })
  } catch (e) {
    return NextResponse.json({ ok: false, erro: e instanceof Error ? e.message : 'Falha ao aplicar crédito.' }, { status: 422 })
  }
}
