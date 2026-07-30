// src/services/registral/gancho-documental.ts
//
// MRG — GANCHO de RECONCILIAÇÃO CONTÍNUA (requisito 6 do escopo, 10 do protocolo).
//
// "Toda nova certidão deve revalidar automaticamente..." — este é o ponto onde
// isso acontece de verdade. Sempre que um documento é anexado, alterado,
// transcrito, reprocessado ou tem sua necessidade transicionada, o Discovery
// publica UM evento na DomainOutbox (a fila que já existe) e o dispatcher faz a
// reconciliação fora do caminho crítico da requisição.
//
// Por que evento e não chamada direta: reconciliar percorre a árvore inteira e
// recalcula linhagem. Fazer isso dentro do POST de um upload transformaria um
// clique de 200ms num clique de vários segundos — e uma falha na reconciliação
// derrubaria o upload, que é o oposto do que se quer.
//
// IMPORTANTE — sem alteração visual: este gancho não muda nenhuma resposta de
// API existente. Ele só publica evento. Falha aqui NUNCA propaga para o
// chamador (o upload não pode quebrar porque a reconciliação teve um problema).

import { prisma } from "@/lib/prisma"
import type { Prisma } from "@prisma/client"
import { chaveEventoOutbox } from "@/src/lib/genealogia/registral/chaves"
import { logRegistral, publicarEvento } from "./auditoria"
import { EVENTOS } from "./constantes"

type DB = typeof prisma | Prisma.TransactionClient

export type MotivoReconciliacao =
  | "documento_anexado"
  | "documento_alterado"
  | "documento_transcrito"
  | "documento_reprocessado"
  | "documento_invalidado"
  | "necessidade_transicionada"
  | "proposta_aplicada"
  | "arvore_alterada"

/**
 * Descobre o processo de um documento (via necessidade ou via árvore da pessoa)
 * e publica o evento de reconciliação.
 *
 * `chaveIdempotencia` inclui o motivo e o instante em janela de minuto: dois
 * uploads no mesmo minuto pelo mesmo motivo geram UM evento (a reconciliação é
 * de processo inteiro, não de documento — reconciliar duas vezes seria trabalho
 * repetido sem efeito diferente).
 */
export async function notificarDocumentoAlterado(
  p: { documentoId: number; motivo: MotivoReconciliacao; usuarioId?: number | null; instante?: number },
  db: DB = prisma,
): Promise<{ publicado: boolean; processoId: number | null }> {
  try {
    const doc = await db.documento.findUnique({
      where: { id: p.documentoId },
      select: {
        id: true,
        necessidade: { select: { processoId: true } },
        pessoa: { select: { arvoreId: true } },
      },
    })
    if (!doc) return { publicado: false, processoId: null }

    let processoId = doc.necessidade?.processoId ?? null
    if (processoId == null && doc.pessoa?.arvoreId != null) {
      const proc = await db.processo.findFirst({
        where: { arvoreId: doc.pessoa.arvoreId },
        orderBy: { id: "asc" },
        select: { id: true },
      })
      processoId = proc?.id ?? null
    }
    if (processoId == null) return { publicado: false, processoId: null }

    return {
      publicado: await publicar(db, processoId, p.motivo, p.documentoId, p.usuarioId ?? null, p.instante),
      processoId,
    }
  } catch (e) {
    // Reconciliação é convergente e reexecutável: perder um evento não corrompe
    // nada (o próximo evento, o worker ou o reprocessamento manual convergem).
    logRegistral("warn", "gancho_documental_falhou", {
      documentoId: p.documentoId,
      motivo: p.motivo,
      erro: e instanceof Error ? e.message : String(e),
    })
    return { publicado: false, processoId: null }
  }
}

/** Gancho para transições de NecessidadeDocumental. */
export async function notificarNecessidadeTransicionada(
  p: { necessidadeId: number; usuarioId?: number | null; instante?: number },
  db: DB = prisma,
): Promise<{ publicado: boolean; processoId: number | null }> {
  try {
    const nec = await db.necessidadeDocumental.findUnique({
      where: { id: p.necessidadeId },
      select: { processoId: true },
    })
    if (!nec) return { publicado: false, processoId: null }
    return {
      publicado: await publicar(
        db,
        nec.processoId,
        "necessidade_transicionada",
        p.necessidadeId,
        p.usuarioId ?? null,
        p.instante,
      ),
      processoId: nec.processoId,
    }
  } catch (e) {
    logRegistral("warn", "gancho_necessidade_falhou", {
      necessidadeId: p.necessidadeId,
      erro: e instanceof Error ? e.message : String(e),
    })
    return { publicado: false, processoId: null }
  }
}

/** Gancho para alteração direta na árvore (pessoa/união criada ou editada). */
export async function notificarArvoreAlterada(
  p: { arvoreId: number; usuarioId?: number | null; instante?: number },
  db: DB = prisma,
): Promise<{ publicado: boolean; processoId: number | null }> {
  try {
    const proc = await db.processo.findFirst({
      where: { arvoreId: p.arvoreId },
      orderBy: { id: "asc" },
      select: { id: true },
    })
    if (!proc) return { publicado: false, processoId: null }
    return {
      publicado: await publicar(db, proc.id, "arvore_alterada", p.arvoreId, p.usuarioId ?? null, p.instante),
      processoId: proc.id,
    }
  } catch (e) {
    logRegistral("warn", "gancho_arvore_falhou", {
      arvoreId: p.arvoreId,
      erro: e instanceof Error ? e.message : String(e),
    })
    return { publicado: false, processoId: null }
  }
}

async function publicar(
  db: DB,
  processoId: number,
  motivo: MotivoReconciliacao,
  referencia: number,
  usuarioId: number | null,
  instante?: number,
): Promise<boolean> {
  const agora = instante ?? Date.now()
  const janelaMinuto = Math.floor(agora / 60_000)
  const chave = chaveEventoOutbox({
    tipo: `${EVENTOS.RECONCILIAR_PROCESSO}:${motivo}`,
    processoId,
    referencia: janelaMinuto,
  })
  const correlationId = `mrg-recon-${processoId}-${janelaMinuto.toString(36)}`

  await publicarEvento(db, {
    tipo: EVENTOS.RECONCILIAR_PROCESSO,
    aggregateType: "Processo",
    aggregateId: processoId,
    payload: { processoId, motivo, referencia, usuarioId },
    correlationId,
    chaveIdempotencia: chave,
  })
  return true
}
