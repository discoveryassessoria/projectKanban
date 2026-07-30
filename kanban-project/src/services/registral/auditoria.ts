// src/services/registral/auditoria.ts
//
// MRG — auditoria e observabilidade persistidas.
//
// Toda escrita do motor registral passa por `auditar`. Duas regras:
//   1. reusa LogAuditoria (a tabela de auditoria que já existe) — não cria uma
//      segunda trilha de auditoria paralela;
//   2. o payload é REDIGIDO antes de gravar: nome completo, trecho do documento
//      e demais conteúdos sensíveis entram reduzidos (inicial + tamanho). O
//      requisito é explícito: "não registrar conteúdo sensível integral em logs".

import { prisma } from "@/lib/prisma"
import type { Prisma } from "@prisma/client"
import { janelaDe, redigirParaLog, type AmostraMetrica } from "@/src/lib/genealogia/registral/metricas"

type DB = typeof prisma | Prisma.TransactionClient

export interface EntradaAuditoria {
  acao: string
  entidade: string
  entidadeId?: number | null
  descricao: string
  detalhes?: unknown
  usuarioId?: number | null
  correlationId?: string | null
}

/**
 * Registra na trilha oficial. Nunca lança: auditoria que derruba a operação
 * transforma um registro faltante em prejuízo de dado. Falha vai para o log
 * estruturado do runtime.
 */
export async function auditar(db: DB, e: EntradaAuditoria): Promise<void> {
  const detalhes = {
    ...(e.correlationId ? { correlationId: e.correlationId } : {}),
    ...(e.detalhes && typeof e.detalhes === "object" ? (redigirParaLog(e.detalhes) as object) : { valor: redigirParaLog(e.detalhes) }),
  }
  try {
    await db.logAuditoria.create({
      data: {
        acao: e.acao.slice(0, 50),
        entidade: e.entidade.slice(0, 50),
        entidadeId: e.entidadeId ?? null,
        descricao: e.descricao.slice(0, 2000),
        detalhes: detalhes as Prisma.InputJsonValue,
        usuarioId: e.usuarioId ?? null,
      },
    })
  } catch (err) {
    console.error("[registral][auditoria] falha ao gravar trilha", {
      acao: e.acao,
      entidade: e.entidade,
      entidadeId: e.entidadeId,
      erro: err instanceof Error ? err.message : String(err),
    })
  }
}

/**
 * Acumula métricas na janela da hora (upsert atômico por chave+escopo+janela).
 * `valor` soma; `amostras` conta — média = valor/amostras para métricas de tempo.
 */
export async function registrarMetricas(
  db: DB,
  amostras: AmostraMetrica[],
  instante: Date,
): Promise<void> {
  const janela = janelaDe(instante)
  for (const a of amostras) {
    try {
      await db.metricaRegistral.upsert({
        where: {
          chave_escopo_janelaInicio: { chave: a.chave, escopo: a.escopo.slice(0, 40), janelaInicio: janela },
        },
        update: { valor: { increment: a.valor }, amostras: { increment: 1 } },
        create: { chave: a.chave, escopo: a.escopo.slice(0, 40), janelaInicio: janela, valor: a.valor, amostras: 1 },
      })
    } catch (err) {
      console.error("[registral][metrica] falha ao acumular", {
        chave: a.chave,
        escopo: a.escopo,
        erro: err instanceof Error ? err.message : String(err),
      })
    }
  }
}

/** Log estruturado do runtime (sem conteúdo sensível). */
export function logRegistral(
  nivel: "info" | "warn" | "error",
  evento: string,
  dados: Record<string, unknown>,
): void {
  const payload = { motor: "registral", evento, ...(redigirParaLog(dados) as object) }
  if (nivel === "error") console.error(JSON.stringify(payload))
  else if (nivel === "warn") console.warn(JSON.stringify(payload))
  else console.info(JSON.stringify(payload))
}

/**
 * Publica um evento na DomainOutbox (a fila que já existe no Discovery).
 * Idempotente por `chaveIdempotencia`: publicar o mesmo evento duas vezes é no-op.
 */
export async function publicarEvento(
  db: DB,
  e: {
    tipo: string
    aggregateType: string
    aggregateId: number
    payload: Prisma.InputJsonValue
    correlationId: string
    causationId?: string | null
    chaveIdempotencia: string
  },
): Promise<void> {
  try {
    await db.domainOutbox.create({
      data: {
        tipo: e.tipo,
        aggregateType: e.aggregateType,
        aggregateId: e.aggregateId,
        payload: e.payload,
        correlationId: e.correlationId,
        causationId: e.causationId ?? null,
        chaveIdempotencia: e.chaveIdempotencia,
      },
    })
  } catch (err) {
    // P2002 = evento já publicado. É o comportamento desejado, não um erro.
    if ((err as { code?: string })?.code === "P2002") return
    throw err
  }
}
