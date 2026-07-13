// src/lib/process-stage/recalculate.ts

/**
 * Orquestrador da fase do processo.
 *
 * Carrega os documentos do processo via Prisma, deriva a fase atual,
 * e move o card no kanban (atualiza Processo.statusId) se a fase mudou.
 *
 * Esta é a função que deve ser chamada nos endpoints que mudam status
 * de documento (PUT /api/documentos/[id], conclusão de step de workflow,
 * criação de novo documento pela engine, etc).
 *
 * Pode ser chamada com:
 *   - prisma client (em endpoints normais)
 *   - prisma transaction client (dentro de prisma.$transaction)
 *
 * NÃO faz throw — em caso de erro retorna { ok: false, error }.
 */

import type { PrismaClient } from "@prisma/client"
import { processoEmRuntimeV2Com } from "@/src/lib/motor/runtime-guard"
import {
  deriveProcessStage,
  STAGE_LABELS,
  STAGE_TO_STATUS_NAME,
  type DerivedStage,
  type ProcessStage,
} from "./derive-stage"

/** Aceita tanto o client global quanto um TransactionClient. */
type PrismaLike = PrismaClient | Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0]

export interface RecalculateResult {
  ok: boolean
  processoId: number
  derived?: DerivedStage
  /** True se o statusId do processo mudou no banco. */
  moved: boolean
  fromStatusId?: number | null
  toStatusId?: number | null
  fromStage?: string
  toStage?: ProcessStage
  /** Quando não conseguiu mover (sem coluna no kanban, etc.) */
  warning?: string
  error?: string
}

/**
 * Recalcula a fase do processo. Se mudou, move o card.
 *
 * @param prisma  client (ou tx) do Prisma
 * @param processoId  ID do processo a recalcular
 * @returns resultado com info pra log
 */
export async function recalculateProcessStage(
  prisma: PrismaLike,
  processoId: number,
): Promise<RecalculateResult> {
  try {
    // Auditoria item 2 — FAIL-CLOSED: em runtime v2 o recálculo legado NÃO move o
    // board (statusId). Só o PhaseAdvanceService controla a fase no v2. Lê o runtime
    // pelo mesmo client recebido (tx-consistente).
    if (await processoEmRuntimeV2Com(prisma, processoId)) {
      return { ok: true, processoId, moved: false, warning: "runtime v2: recálculo/statusId legado inativo" }
    }

    // 1. Busca processo + documentos via árvore -> pessoas -> documentos
    const processo = await prisma.processo.findUnique({
      where: { id: processoId },
      include: {
        status: true,
        arvore: {
          include: {
            pessoas: {
              include: {
                documentos: {
                  select: { id: true, status: true },
                },
              },
            },
          },
        },
      },
    })

    if (!processo) {
      return {
        ok: false,
        processoId,
        moved: false,
        error: "processo não encontrado",
      }
    }

    // 2. Flatten dos documentos
    const docs = (processo.arvore?.pessoas ?? []).flatMap((p) =>
      p.documentos.map((d) => ({ id: d.id, status: d.status })),
    )

    // 3. Deriva a fase
    const derived = deriveProcessStage(docs)

    // 4. Encontra o Status correspondente no banco (por nome + país)
    const targetStatusName = STAGE_TO_STATUS_NAME[derived.stage]
    const targetStatus = await prisma.status.findFirst({
      where: { pais: processo.pais, nome: targetStatusName },
    })

    if (!targetStatus) {
      return {
        ok: true,
        processoId,
        derived,
        moved: false,
        fromStatusId: processo.statusId,
        toStage: derived.stage,
        warning: `Status "${targetStatusName}" não existe no kanban de ${processo.pais}. Card não movido. (Crie a coluna no banco pra ativar a sincronização.)`,
      }
    }

    // 5. Já está no status certo?
    if (processo.statusId === targetStatus.id) {
      return {
        ok: true,
        processoId,
        derived,
        moved: false,
        fromStatusId: processo.statusId,
        toStatusId: targetStatus.id,
        toStage: derived.stage,
      }
    }

    // 6. Move o card
    await prisma.processo.update({
      where: { id: processoId },
      data: { statusId: targetStatus.id },
    })

    return {
      ok: true,
      processoId,
      derived,
      moved: true,
      fromStatusId: processo.statusId,
      fromStage: processo.status?.nome,
      toStatusId: targetStatus.id,
      toStage: derived.stage,
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error(`[recalculateProcessStage] processoId=${processoId} falhou:`, e)
    return {
      ok: false,
      processoId,
      moved: false,
      error: msg,
    }
  }
}

/**
 * Versão que recebe o pessoaId e descobre o processoId via arvoreId.
 * Útil quando o endpoint só tem o pessoaId em mãos (ex: PUT /api/pessoas/[id]).
 *
 * Recalcula TODOS os processos da árvore (uma pessoa pode estar em mais de um?
 * por enquanto: árvore → processos é 1-N, então pode precisar recalcular vários).
 */
export async function recalculateByPessoaId(
  prisma: PrismaLike,
  pessoaId: number,
): Promise<RecalculateResult[]> {
  const pessoa = await prisma.pessoa.findUnique({
    where: { id: pessoaId },
    select: {
      arvore: {
        select: {
          processos: { select: { id: true } },
        },
      },
    },
  })

  const processoIds = pessoa?.arvore?.processos.map((p) => p.id) ?? []
  if (processoIds.length === 0) return []

  const results = await Promise.all(
    processoIds.map((id) => recalculateProcessStage(prisma, id)),
  )
  return results
}

/**
 * Versão que recebe documentoId e descobre o processoId.
 * Útil em PUT /api/documentos/[id].
 */
export async function recalculateByDocumentoId(
  prisma: PrismaLike,
  documentoId: number,
): Promise<RecalculateResult[]> {
  const doc = await prisma.documento.findUnique({
    where: { id: documentoId },
    select: {
      pessoa: {
        select: {
          arvore: {
            select: {
              processos: { select: { id: true } },
            },
          },
        },
      },
    },
  })

  const processoIds = doc?.pessoa?.arvore?.processos.map((p) => p.id) ?? []
  if (processoIds.length === 0) return []

  const results = await Promise.all(
    processoIds.map((id) => recalculateProcessStage(prisma, id)),
  )
  return results
}

/** Helper pra UI: retorna só o label da fase a partir do statusName. */
export function stageLabelFromStatusName(name: string | null | undefined): string {
  if (!name) return "—"
  // Tenta achar pela tabela reversa
  for (const stage of Object.keys(STAGE_TO_STATUS_NAME) as ProcessStage[]) {
    if (STAGE_TO_STATUS_NAME[stage] === name) return STAGE_LABELS[stage]
  }
  return name
}