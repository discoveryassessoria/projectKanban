// src/services/genealogia/emitir-evento-requerente.ts
// ============================================================================
// EVENTO DE DOMÍNIO oficial: REQUERENTE_ADICIONADO — PRIMITIVA DE ENFILEIRAMENTO.
//
// Enfileira na DomainOutbox (transacional, dedup por chaveIdempotencia @unique) UM
// evento por processo da árvore quando uma Pessoa passa a ser requerente. Publicado
// SEMPRE via Outbox — nunca um efeito financeiro direto na requisição HTTP.
//
// ─── QUEM PODE CHAMAR ───────────────────────────────────────────────────────
// SÓ `lib/genealogia/vincular-requerente.ts`, o serviço canônico do domínio.
//
// Havia aqui um segundo export, `emitirEDrenarEventoRequerente`, que abria a sua
// própria transação e drenava a fila — feito para as ROTAS chamarem depois de
// gravar. Era a segunda porta: quem entrava pelo serviço criava o vínculo e não
// emitia; quem entrava pela rota emitia. Dois estados finais para o mesmo ato.
//
// Ele foi REMOVIDO em vez de proibido. Porta que não existe não precisa de guard
// — e o guard que existe (`test:guard-porta-requerente`) impede que ela volte.
// ============================================================================
import { Prisma } from '@prisma/client'

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

// A DRENAGEM não mora mais aqui. Ela é pós-commit por natureza — a transação que
// enfileira precisa ter fechado antes de alguém consumir a fila — e por isso vive
// em `efeitosDoVinculoPosCommit`, no serviço canônico, junto do outro efeito
// pós-commit do mesmo ato (a reavaliação das Regras Documentais). Dois efeitos que
// acontecem sempre juntos não devem ser duas chamadas que o caller pode esquecer
// pela metade.
