// /api/financeiro/v3/ocorrencias — REGISTRA uma ocorrência financeira (Motor V3).
//   POST { obrigacaoId, tipo, valor, moeda?, pagador?, aplicacao?, excedenteDestino?, ... }
// Flag-gated (ocorrencias). Não substitui o legado — opera sobre a obrigação V3.
import { NextRequest, NextResponse } from 'next/server'
import { verificarPermissao, extrairUsuarioComPermissoes } from '@/src/lib/verificar-permissao'
import { flagAtiva } from '@/lib/financeiro/flags'
import { registrarOcorrencia } from '@/lib/financeiro/ocorrencias/ocorrencia-service'
import { usuarioFlag } from '../_flags'

export async function POST(req: NextRequest) {
  const erro = await verificarPermissao(req, 'financeiro.ver'); if (erro) return erro
  const u = await usuarioFlag(req)
  if (!flagAtiva('ocorrencias', u)) {
    return NextResponse.json({ ok: false, motivo: 'Ocorrências V3 não habilitadas neste ambiente/usuário.' }, { status: 409 })
  }
  const b = await req.json().catch(() => ({}))
  if (!b?.obrigacaoId || !b?.tipo || b?.valor == null) return NextResponse.json({ erro: 'obrigacaoId, tipo e valor são obrigatórios.' }, { status: 400 })

  const actor = await extrairUsuarioComPermissoes(req)
  try {
    const r = await registrarOcorrencia({
      obrigacaoId: Number(b.obrigacaoId), tipo: b.tipo, valor: Number(b.valor), moeda: b.moeda,
      data: b.data ? new Date(b.data) : undefined, formaPagamentoId: b.formaPagamentoId ?? null,
      origemRecurso: b.origemRecurso ?? null, pagador: b.pagador ?? null, aplicacao: b.aplicacao ?? null,
      excedenteDestino: b.excedenteDestino ?? null, tarifa: b.tarifa ?? null, diferencaCambial: b.diferencaCambial ?? null,
      estornaOcorrenciaId: b.estornaOcorrenciaId ?? null, comprovanteUrl: b.comprovanteUrl ?? null,
      observacao: b.observacao ?? null, idempotencyKey: b.idempotencyKey ? String(b.idempotencyKey).slice(0, 110) : null,
      criadoPorId: actor?.userId ?? null,
    })
    return NextResponse.json({ ok: true, ...r })
  } catch (e) {
    return NextResponse.json({ ok: false, erro: e instanceof Error ? e.message : 'Falha ao registrar ocorrência.' }, { status: 422 })
  }
}
