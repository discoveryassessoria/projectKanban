// lib/financeiro/conciliacao/conciliacao-service.ts
// ============================================================================
// CONCILIAÇÃO BANCÁRIA — serviço server (Motor Financeiro V3 · Fase 3).
// Importa linhas de extrato (dedup por identificador) e as concilia contra as
// ocorrências de PAGAMENTO do Ledger. Dry-run por padrão; ao aplicar, marca cada
// linha CONCILIADO (vincula ocorrência) ou DIVERGENTE (com o motivo). Nunca
// resolve divergência em silêncio; nunca apaga histórico.
// ============================================================================
import { prisma } from '@/lib/prisma'
import { conciliar, type LinhaExtrato, type OcorrenciaConciliavel } from './matching'
import { aplicarTransicaoEstadoCustoTx } from '../acoes/estado-custo-service'

const cent = (v: number) => Math.round((Number(v) || 0) * 100) / 100

export interface EntradaLinha {
  data: string | Date
  valorBruto: number
  valorTarifa?: number | null
  valorLiquido?: number | null
  identificadorTransacao?: string | null
  contaRecebimentoId?: number | null
  descricao?: string | null
}

/** Importa linhas de extrato (idempotente por identificadorTransacao). */
export async function importarExtrato(linhas: EntradaLinha[], opts?: { origem?: string; criadoPorId?: number | null }) {
  let inseridas = 0, duplicadas = 0
  for (const l of linhas) {
    const ident = l.identificadorTransacao ?? null
    if (ident) {
      const existe = await prisma.lancamentoBancario.findUnique({ where: { identificadorTransacao: ident }, select: { id: true } })
      if (existe) { duplicadas++; continue }
    }
    const bruto = cent(l.valorBruto)
    const tarifa = l.valorTarifa != null ? cent(l.valorTarifa) : null
    const liquido = l.valorLiquido != null ? cent(l.valorLiquido) : cent(bruto - (tarifa ?? 0))
    await prisma.lancamentoBancario.create({ data: {
      data: new Date(l.data), valorBruto: bruto, valorTarifa: tarifa, valorLiquido: liquido,
      identificadorTransacao: ident, contaRecebimentoId: l.contaRecebimentoId ?? null, descricao: l.descricao ?? null,
      status: 'INFORMADO', origem: opts?.origem ?? 'manual', criadoPorId: opts?.criadoPorId ?? null,
    } })
    inseridas++
  }
  return { inseridas, duplicadas }
}

/**
 * Concilia as linhas INFORMADO contra as ocorrências de pagamento ainda não
 * conciliadas. `aplicar:false` (default) só relata. Ao aplicar, persiste os
 * status/vínculos. Idempotente (linhas já conciliadas não são reprocessadas).
 */
export async function conciliarPendentes(input?: { toleranciaDias?: number; aplicar?: boolean; criadoPorId?: number | null }) {
  const aplicar = input?.aplicar === true

  const linhasDB = await prisma.lancamentoBancario.findMany({ where: { status: 'INFORMADO' }, orderBy: { id: 'asc' } })
  const linhas: LinhaExtrato[] = linhasDB.map((l) => ({ id: l.id, data: l.data, valorLiquido: Number(l.valorLiquido), identificadorTransacao: l.identificadorTransacao }))

  // ocorrências de pagamento PROCESSADAS ainda não vinculadas a nenhuma linha
  const jaVinculadas = new Set((await prisma.lancamentoBancario.findMany({ where: { ocorrenciaId: { not: null } }, select: { ocorrenciaId: true } })).map((x) => x.ocorrenciaId!))
  const ocDB = await prisma.ocorrenciaFinanceira.findMany({
    where: { tipo: { in: ['PAGAMENTO', 'PAGAMENTO_PARCIAL'] }, status: 'PROCESSADA' },
    select: { id: true, obrigacaoId: true, data: true, valor: true, correlacaoId: true },
    orderBy: { id: 'asc' },
  })
  const ocorrencias: OcorrenciaConciliavel[] = ocDB.map((o) => ({
    ocorrenciaId: o.id, obrigacaoId: o.obrigacaoId, data: o.data, valor: Number(o.valor),
    identificadorTransacao: o.correlacaoId, jaConciliada: jaVinculadas.has(o.id),
  }))

  const resultado = conciliar(linhas, ocorrencias, { toleranciaDias: input?.toleranciaDias })

  if (aplicar) {
    for (const r of resultado.linhas) {
      if (r.status === 'CONCILIADO') {
        await prisma.$transaction(async (tx) => {
          await tx.lancamentoBancario.update({ where: { id: r.linhaId }, data: { status: 'CONCILIADO', ocorrenciaId: r.ocorrenciaId, obrigacaoId: r.obrigacaoId, divergencia: null } })
          // F4.2 — custo já PAGO conciliado → CONCILIADO (máquina barra custo não-pago).
          if (r.obrigacaoId != null) await aplicarTransicaoEstadoCustoTx(tx, r.obrigacaoId, 'CONCILIADO', { usuarioId: input?.criadoPorId ?? null, motivo: 'conciliação bancária' })
        })
      } else if (r.status === 'DIVERGENTE') {
        await prisma.lancamentoBancario.update({ where: { id: r.linhaId }, data: { status: 'DIVERGENTE', divergencia: r.divergencia } })
      }
      // SEM_CORRESPONDENCIA permanece INFORMADO (aguardando nova ocorrência) com o motivo registrado
      else await prisma.lancamentoBancario.update({ where: { id: r.linhaId }, data: { divergencia: r.divergencia } })
    }
  }

  return { aplicar, ...resultado }
}
