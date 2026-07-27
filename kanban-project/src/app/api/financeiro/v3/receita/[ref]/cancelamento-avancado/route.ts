// /api/financeiro/v3/receita/[ref]/cancelamento-avancado
//   POST            → executa o cancelamento profissional (transacional, auditável)
//   POST ?preview=1 → retorna a PREVISÃO (não grava): o que cancela/permanece + impacto
// Body { modo, valor?, percentual?, participanteObrigacaoId?, participanteReceitaId?, parcelaIds?, motivo?, idempotencyKey? }
// Flag-gated (posicaoRead|ocorrencias). O cancelamento simples (cancelar) segue funcionando.
import { NextRequest, NextResponse } from 'next/server'
import { verificarPermissao, extrairUsuarioComPermissoes } from '@/src/lib/verificar-permissao'
import { flagAtiva } from '@/lib/financeiro/flags'
import { usuarioFlag } from '../../../_flags'
import { previsaoCancelamento, executarCancelamento, type CancelamentoInput, type ModoCancelamento } from '@/lib/financeiro/acoes/cancelamento-avancado'

const MODOS: ModoCancelamento[] = ['TOTAL', 'PARCIAL_VALOR', 'PARCIAL_PERCENTUAL', 'POR_PARTICIPANTE', 'POR_PARCELA']

async function guard(req: NextRequest) {
  const erro = await verificarPermissao(req, 'financeiro.ver'); if (erro) return erro
  const u = await usuarioFlag(req)
  if (!flagAtiva('posicaoRead', u) && !flagAtiva('ocorrencias', u)) {
    return NextResponse.json({ ok: false, erro: 'Cancelamento V3 não habilitado neste ambiente/usuário.' }, { status: 409 })
  }
  return null
}

function extrairInput(ref: string, b: Record<string, unknown>): CancelamentoInput {
  return {
    ref,
    modo: b.modo as ModoCancelamento,
    valor: b.valor === undefined || b.valor == null ? null : Number(b.valor),
    percentual: b.percentual === undefined || b.percentual == null ? null : Number(b.percentual),
    participanteObrigacaoId: b.participanteObrigacaoId == null ? null : Number(b.participanteObrigacaoId),
    participanteReceitaId: b.participanteReceitaId == null ? null : Number(b.participanteReceitaId),
    parcelaIds: Array.isArray(b.parcelaIds) ? (b.parcelaIds as unknown[]).map((x) => Number(x)) : null,
    motivo: typeof b.motivo === 'string' ? b.motivo : null,
    idempotencyKey: typeof b.idempotencyKey === 'string' ? b.idempotencyKey : null,
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ ref: string }> }) {
  const bloqueio = await guard(req); if (bloqueio) return bloqueio
  const { ref } = await params
  const b = await req.json().catch(() => ({} as Record<string, unknown>))
  const input = extrairInput(ref, b)
  if (!MODOS.includes(input.modo)) return NextResponse.json({ ok: false, erro: `modo inválido (use: ${MODOS.join(', ')}).` }, { status: 400 })

  const isPreview = req.nextUrl.searchParams.get('preview') === '1'
  if (isPreview) {
    try {
      const prev = await previsaoCancelamento(input)
      if (!prev) return NextResponse.json({ ok: false, erro: 'Receita não encontrada.' }, { status: 404 })
      return NextResponse.json({ ok: true, previsao: prev })
    } catch (e) {
      return NextResponse.json({ ok: false, erro: e instanceof Error ? e.message : 'Falha ao calcular a previsão.' }, { status: 422 })
    }
  }

  const actor = await extrairUsuarioComPermissoes(req)
  try {
    const r = await executarCancelamento(input, { criadoPorId: actor?.userId ?? null })
    if (!r.ok) return NextResponse.json({ ok: false, erro: r.erros[0] ?? 'Falha na validação.', erros: r.erros }, { status: 422 })
    return NextResponse.json({ ...r, ok: true })
  } catch (e) {
    return NextResponse.json({ ok: false, erro: e instanceof Error ? e.message : 'Falha ao cancelar.' }, { status: 422 })
  }
}
