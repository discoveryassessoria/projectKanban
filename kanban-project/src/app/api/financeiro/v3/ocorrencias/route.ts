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
  // Registrar ocorrência é o par de escrita da leitura da Posição: se a Posição
  // V3 (posicaoRead) está habilitada, o registro também está. Mantém compat com a
  // flag específica 'ocorrencias' (aditivo — só afrouxa, nunca restringe).
  if (!flagAtiva('ocorrencias', u) && !flagAtiva('posicaoRead', u)) {
    return NextResponse.json({ ok: false, motivo: 'Ocorrências V3 não habilitadas neste ambiente/usuário.' }, { status: 409 })
  }
  const b = await req.json().catch(() => ({}))
  if (!b?.obrigacaoId || !b?.tipo || b?.valor == null) return NextResponse.json({ erro: 'obrigacaoId, tipo e valor são obrigatórios.' }, { status: 400 })
  // sinal: todos os tipos (PAGAMENTO/JUROS/MULTA/DESCONTO/ESTORNO) usam VALOR POSITIVO.
  // Sem esta guarda, um JUROS/MULTA negativo reduziria o "a receber" arbitrariamente
  // (podendo negativar o saldo), contornando o clamp que só existe no ramo DESCONTO.
  const valorNum = Number(b.valor)
  if (!Number.isFinite(valorNum) || valorNum <= 0) return NextResponse.json({ erro: 'valor deve ser um número maior que zero.' }, { status: 400 })
  // ESTORNO exige idempotencyKey OBRIGATÓRIA (anti duplo-clique/retry concorrente): a mesma
  // chave retorna o mesmo resultado sem remutar; o motor ainda serializa por FOR UPDATE.
  if (b.tipo === 'ESTORNO' && !b.idempotencyKey) return NextResponse.json({ erro: 'Estorno exige idempotencyKey (proteção contra duplicidade).' }, { status: 400 })

  const actor = await extrairUsuarioComPermissoes(req)
  try {
    const r = await registrarOcorrencia({
      obrigacaoId: Number(b.obrigacaoId), tipo: b.tipo, valor: valorNum, moeda: b.moeda,
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
