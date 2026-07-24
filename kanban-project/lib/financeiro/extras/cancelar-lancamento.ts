// lib/financeiro/extras/cancelar-lancamento.ts
// ============================================================================
// CANCELAMENTO auditável de um lançamento (ObrigacaoEconomica). NUNCA apaga o
// histórico: registra uma ocorrência de ESTORNO que reverte TODOS os entries do
// Ledger (zera saldo/recebido), muda o status para CANCELADO e emite evento +
// auditoria. Idempotente: cancelar duas vezes não duplica nem quebra.
// ============================================================================
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { registrarLancamento } from '../ledger/ledger-service'
import { lancEstorno, type Perna, type Direcao } from '../ledger/lancamentos'
import { transicionar, type StatusObrigacao } from '../dominio/obrigacao-economica'
import { chaveEvento } from '../dominio/eventos'

export async function cancelarObrigacao(input: { obrigacaoId: number; motivo?: string | null; criadoPorId?: number | null }): Promise<{ obrigacaoId: number; jaCancelada: boolean }> {
  return prisma.$transaction(async (tx) => {
    const obr = await tx.obrigacaoEconomica.findUnique({ where: { id: input.obrigacaoId }, include: { ledger: { include: { entries: true } } } })
    if (!obr || !obr.ledger) throw new Error('Obrigação/Ledger inexistente.')
    if (obr.status === 'CANCELADO') return { obrigacaoId: obr.id, jaCancelada: true }

    const t = transicionar(obr.status as StatusObrigacao, 'CANCELADO')
    if (!t.ok) throw new Error(t.erro ?? 'Transição para CANCELADO inválida.')

    // Reverte o NET de todos os entries atuais → projeção zera (saldo e pago).
    const pernas: Perna[] = obr.ledger.entries.map((e) => ({ conta: e.contaContabil, direcao: e.direcao as Direcao, valor: Number(e.valorContabil) }))
    if (pernas.length) {
      const oc = await tx.ocorrenciaFinanceira.create({ data: {
        obrigacaoId: obr.id, tipo: 'ESTORNO', valor: Number(obr.valorContratado), moeda: obr.moedaContratual, data: new Date(),
        status: 'PROCESSADA', observacao: input.motivo ? `Cancelamento: ${input.motivo}` : 'Cancelamento do lançamento', idempotencyKey: `cancelar:${obr.id}`, criadoPorId: input.criadoPorId ?? null,
      } })
      await registrarLancamento(tx, { obrigacaoId: obr.id, ledgerId: obr.ledger.id, transacaoId: `cancelar:${obr.id}`, lancamento: lancEstorno(pernas), ocorrenciaId: oc.id, moeda: obr.moedaContratual, criadoPorId: input.criadoPorId ?? null })
    }

    await tx.obrigacaoEconomica.update({ where: { id: obr.id }, data: { status: 'CANCELADO' } })

    await tx.domainOutbox.create({ data: {
      tipo: 'financeiro.obrigacao.cancelada', aggregateType: 'ObrigacaoEconomica', aggregateId: obr.id,
      payload: { obrigacaoId: obr.id, motivo: input.motivo ?? null } as Prisma.InputJsonValue,
      chaveIdempotencia: chaveEvento('financeiro.obrigacao.cancelada', obr.id),
    } }).catch(() => { /* idempotente */ })

    return { obrigacaoId: obr.id, jaCancelada: false }
  })
}
