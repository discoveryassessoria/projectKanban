// §10 — cancelar Receita (lançamento aberto). Idempotente.
//
// Lançamento gerado pelo FinanceRuleEngine NÃO é apagado nem cancelado sem tratar
// a causa: quando a origem operacional segue ativa, o cancelamento exige uma
// SUPRESSÃO rastreável (motivo + usuário + data), registrada no MotorArtefato de
// origem. Sem ela o motor recriaria o lançamento na próxima reconciliação.
import { NextRequest, NextResponse } from 'next/server'
import { cancelarLancamento } from '@/lib/financeiro/cancelamento-estorno'
import { origemOperacionalDoLancamento, suprimirOrigem } from '@/lib/financeiro/supressao-motor'
import { prisma } from '@/lib/prisma'

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id: idStr } = await ctx.params
    const id = Number(idStr)
    if (!id || isNaN(id)) return NextResponse.json({ error: 'id inválido' }, { status: 400 })

    const b = await req.json().catch(() => ({}))
    const motivo = typeof b?.motivo === 'string' ? b.motivo.trim() : ''
    if (motivo.length < 3) {
      return NextResponse.json({ error: 'Informe o motivo do cancelamento (mínimo 3 caracteres).' }, { status: 400 })
    }

    const origem = await origemOperacionalDoLancamento('receita', id)

    // Origem automática ainda ativa → só cancela com supressão explicitamente
    // autorizada; caso contrário orienta a corrigir a causa operacional.
    if (origem?.ativa && b?.suprimirOrigem !== true) {
      return NextResponse.json(
        {
          error: 'ORIGEM_ATIVA',
          mensagem: `Este lançamento continua sendo exigido pela regra financeira ativa (${origem.descricao}). Corrija a origem operacional ou confirme o cancelamento registrando uma supressão autorizada.`,
          origem: {
            descricao: origem.descricao,
            phaseKey: origem.phaseKey,
            evento: origem.event,
            regra: `${origem.ruleSource}/${origem.ruleKind}`,
          },
          exigeSupressao: true,
        },
        { status: 409 },
      )
    }

    const r = await cancelarLancamento('receita', id, {
      motivo,
      atorId: b.atorId ?? null,
      eventoRef: b.eventoRef ?? null,
      ocorrencia: b.ocorrencia ?? null,
    })
    if (!r.ok) {
      return NextResponse.json(r, { status: r.status === 'bloqueado' ? 409 : 400 })
    }

    // Cancelou de fato → registra a supressão para o motor não recriar.
    let supressao = null
    if (r.status === 'cancelado' && origem) {
      supressao = await suprimirOrigem('receita', id, { motivo, usuarioId: b.atorId ?? null })
      await prisma.eventoFinanceiro
        .create({
          data: {
            receitaId: id,
            usuarioId: b.atorId ?? null,
            tipo: 'CANCELAMENTO',
            descricao: `Supressão registrada — o motor não recriará este lançamento. Motivo: ${motivo}`.slice(0, 500),
            dados: { artefatoId: supressao.artefatoId ?? null, automaticKey: origem.automaticKey },
          },
        })
        .catch(() => undefined)
    }

    return NextResponse.json({ ...r, supressao })
  } catch (e) {
    console.error('POST receitas/[id]/cancelar', e)
    return NextResponse.json({ error: 'Erro ao cancelar' }, { status: 500 })
  }
}
