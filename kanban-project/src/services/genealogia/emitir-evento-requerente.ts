// src/services/genealogia/emitir-evento-requerente.ts
// ============================================================================
// EVENTO DE DOMÍNIO oficial: REQUERENTE_ADICIONADO.
//
// Enfileira na DomainOutbox (transacional, dedup por chaveIdempotencia @unique) UM
// evento por processo da árvore quando uma Pessoa passa a ser requerente. Publicado
// SEMPRE via Outbox — nunca um efeito financeiro direto na requisição HTTP. A
// detecção da TRANSIÇÃO (não→requerente) é responsabilidade do caller (rota Pessoa),
// via `houveTransicaoParaRequerente` (lib/genealogia/requerente-flag).
// ============================================================================
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { processarOutbox } from '@/src/services/outbox-dispatcher'

/** Tipo canônico do evento na DomainOutbox. */
export const TIPO_EVENTO_REQUERENTE = 'requerente.adicionado'

export interface ParamsEventoRequerente {
  pessoaId: number
  arvoreId: number
  actorId?: number | null
  correlationId?: string | null
}

/**
 * Enfileira o evento (um por processo da árvore) DENTRO da transação recebida —
 * atômico com a persistência do flag. Idempotente por `req.add::{proc}::{pessoa}`.
 * Retorna quantos eventos foram enfileirados.
 */
export async function enfileirarEventoRequerente(tx: Prisma.TransactionClient, params: ParamsEventoRequerente): Promise<number> {
  const arvore = await tx.arvore.findUnique({
    where: { id: params.arvoreId },
    select: { processos: { select: { id: true, tipoProcessoMotorId: true, faseAtualKey: true, tipoProcessoMotor: { select: { nationalityLabel: true } } } } },
  })
  const processos = arvore?.processos ?? []
  if (processos.length === 0) return 0

  // Requerente (entidade de cobrança) vinculado à Pessoa, se existir.
  const billing = await tx.requerente.findFirst({ where: { personId: params.pessoaId }, select: { id: true } })

  let enfileirados = 0
  for (const p of processos) {
    const chave = `req.add::${p.id}::${params.pessoaId}`
    const existe = await tx.domainOutbox.findFirst({ where: { chaveIdempotencia: chave }, select: { id: true } })
    if (existe) continue // já emitido p/ este (processo, pessoa) — idempotente
    await tx.domainOutbox.create({
      data: {
        tipo: TIPO_EVENTO_REQUERENTE, aggregateType: 'Processo', aggregateId: p.id,
        correlationId: params.correlationId ?? null, causationId: chave, chaveIdempotencia: chave,
        payload: {
          processoId: p.id, pessoaId: params.pessoaId, requerenteId: billing?.id ?? null,
          servicoId: p.tipoProcessoMotorId ?? null, tipoProcessoId: p.tipoProcessoMotorId ?? null,
          faseId: p.faseAtualKey ?? null, phaseKey: p.faseAtualKey ?? null,
          nacionalidade: p.tipoProcessoMotor?.nationalityLabel ?? null,
          actorId: params.actorId ?? null, occurredAt: new Date().toISOString(),
        } as Prisma.InputJsonValue,
      },
    })
    enfileirados++
  }
  return enfileirados
}

/**
 * Atalho para as rotas: enfileira (na sua própria transação, se nenhuma for passada)
 * e DRENA a outbox (best-effort). A drenagem não deve derrubar a requisição — falhas
 * ficam PENDENTE na outbox e são reprocessadas.
 */
export async function emitirEDrenarEventoRequerente(params: ParamsEventoRequerente): Promise<void> {
  try {
    const n = await prisma.$transaction((tx) => enfileirarEventoRequerente(tx, params))
    if (n > 0) await processarOutbox({ tipos: [TIPO_EVENTO_REQUERENTE], limite: 20 }).catch(() => {})
  } catch (e) {
    console.error('[evento requerente] falha ao emitir/drenar:', e)
  }
}
