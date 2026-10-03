// src/services/coleta/coleta-link.ts
// ============================================================================
// LINK DE COLETA — gerar, resolver (público) e encerrar.
//
// Regras (docs/coleta-de-dados-mandato.md §2): UM link ativo por processo; só nasce
// com o processo em "Aguardando fechamento"; vale enquanto o processo está nela e
// `encerradoEm` é nulo. Sair da fase encerra (FASE_MUDOU) — a leitura é quem
// carimba, para valer em QUALQUER porta de mudança de fase sem depender de gancho.
// ============================================================================

import { randomBytes } from "crypto"
import type { ColetaLink } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { ehFaseAguardandoFechamento, ROTULO_AGUARDANDO_FECHAMENTO } from "@/src/lib/process-stage/fase-pre-contrato"

export type MotivoEncerramento = "FASE_MUDOU" | "MANUAL" | "CONFERENCIA"

/** 192 bits aleatórios, url-safe (32 caracteres). */
export function novoCodigoDeColeta(): string {
  return randomBytes(24).toString("base64url")
}

/** O processo ainda aceita coleta? (única definição) */
export const processoAceitaColeta = (faseAtualKey: string | null | undefined) => ehFaseAguardandoFechamento(faseAtualKey)

/**
 * Link ativo do processo. Se o processo já saiu de "Aguardando fechamento" e o link
 * ainda estava aberto, carimba o encerramento (FASE_MUDOU) e devolve `null`.
 */
export async function linkAtivoDoProcesso(processoId: number): Promise<ColetaLink | null> {
  const link = await prisma.coletaLink.findFirst({
    where: { processoId, encerradoEm: null },
    orderBy: { id: "desc" },
    include: { processo: { select: { faseAtualKey: true } } },
  })
  if (!link) return null
  if (!processoAceitaColeta(link.processo.faseAtualKey)) {
    await prisma.coletaLink.updateMany({
      where: { id: link.id, encerradoEm: null },
      data: { encerradoEm: new Date(), motivoEncerramento: "FASE_MUDOU" },
    })
    return null
  }
  const { processo: _p, ...semProcesso } = link
  return semProcesso
}

export type ResultadoGerar =
  | { ok: true; link: ColetaLink; jaExistia: boolean }
  | { ok: false; code: "PROCESSO_NAO_ENCONTRADO" | "FASE_NAO_PERMITE"; message: string }

/** Gera o link (idempotente: se já há um ativo, devolve o mesmo). */
export async function gerarLinkDeColeta(processoId: number, usuarioId: number | null): Promise<ResultadoGerar> {
  const processo = await prisma.processo.findUnique({ where: { id: processoId }, select: { id: true, faseAtualKey: true } })
  if (!processo) return { ok: false, code: "PROCESSO_NAO_ENCONTRADO", message: "Processo não encontrado." }
  if (!processoAceitaColeta(processo.faseAtualKey)) {
    return { ok: false, code: "FASE_NAO_PERMITE", message: `O link de coleta só pode ser gerado com o processo em “${ROTULO_AGUARDANDO_FECHAMENTO}”.` }
  }
  const existente = await linkAtivoDoProcesso(processoId)
  if (existente) return { ok: true, link: existente, jaExistia: true }

  const link = await prisma.$transaction(async (tx) => {
    const criado = await tx.coletaLink.create({ data: { codigo: novoCodigoDeColeta(), processoId, criadoPorId: usuarioId } })
    await tx.logAuditoria.create({
      data: {
        acao: "CRIAR", entidade: "COLETA_LINK", entidadeId: criado.id, usuarioId,
        descricao: `Link de coleta de dados gerado para o processo ${processoId}.`,
        detalhes: { processoId },
      },
    })
    return criado
  })
  return { ok: true, link, jaExistia: false }
}

/** Encerra o link ativo do processo. Idempotente. */
export async function encerrarLinkDeColeta(processoId: number, usuarioId: number | null, motivo: MotivoEncerramento = "MANUAL"): Promise<{ encerrados: number }> {
  return prisma.$transaction(async (tx) => {
    const r = await tx.coletaLink.updateMany({
      where: { processoId, encerradoEm: null },
      data: { encerradoEm: new Date(), motivoEncerramento: motivo, encerradoPorId: usuarioId },
    })
    if (r.count > 0) {
      await tx.logAuditoria.create({
        data: {
          acao: "ENCERRAR", entidade: "COLETA_LINK", entidadeId: null, usuarioId,
          descricao: `Link de coleta do processo ${processoId} encerrado (${motivo}).`,
          detalhes: { processoId, motivo },
        },
      })
    }
    return { encerrados: r.count }
  })
}

/**
 * Resolve o link pela URL pública. `null` para inexistente, encerrado ou com o
 * processo fora de "Aguardando fechamento" — o chamador responde IGUAL nos três casos
 * (não revela qual).
 */
export async function resolverLinkPublico(codigo: string): Promise<{ link: ColetaLink; processoId: number } | null> {
  if (typeof codigo !== "string" || codigo.length < 20 || codigo.length > 64 || !/^[A-Za-z0-9_-]+$/.test(codigo)) return null
  const link = await prisma.coletaLink.findUnique({
    where: { codigo },
    include: { processo: { select: { faseAtualKey: true } } },
  })
  if (!link || link.encerradoEm) return null
  if (!processoAceitaColeta(link.processo.faseAtualKey)) {
    await prisma.coletaLink.updateMany({ where: { id: link.id, encerradoEm: null }, data: { encerradoEm: new Date(), motivoEncerramento: "FASE_MUDOU" } })
    return null
  }
  const { processo: _p, ...semProcesso } = link
  return { link: semProcesso, processoId: link.processoId }
}
