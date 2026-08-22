// src/services/retificacao-canonica.ts
//
// A UNIDADE DE TRABALHO DE UMA RETIFICAÇÃO — e a única porta que a abre e fecha.
//
// ─── QUAL É A UNIDADE, E POR QUÊ ────────────────────────────────────────────
// Não é o processo: um processo pode ter dois pedidos correndo, e concluir um não
// pode concluir o outro. Não é o documento: uma petição corrige vários registros de
// uma vez, e fazer uma cadeia por documento produziria três protocolos onde houve um.
// Não é a divergência: a divergência é o FATO identificado pela Análise, e uma petição
// junta várias — tratar cada uma como uma unidade fragmentaria o pedido.
//
// É o PEDIDO. `RetificacaoPacote` já nomeava exatamente isso: tem número próprio no
// processo, modo judicial ou administrativo, status próprio, e reúne as divergências
// que vão na mesma peça. O que faltava eram os vínculos: órgão e protocolo eram texto,
// as divergências eram um snapshot em JSON, e nenhuma pergunta que importa tinha
// resposta no banco.
//
// ─── O QUE ESTE SERVIÇO NÃO DECIDE ──────────────────────────────────────────
// QUAIS divergências entram no mesmo pedido. Isso é decisão de quem analisa — pode ser
// uma petição por pessoa, uma por cartório, uma por tipo de erro — e o sistema não tem
// como deduzir. Aqui a lista chega pronta; abrir um pacote é sempre um ato explícito.
//
// Enquanto essa regra não for declarada, `GO_RETIFICATION` continua NÃO abrindo pacote
// sozinho: abrir por conta própria seria escolher a regra sem que ninguém a tivesse
// escolhido.

import { Prisma } from "@prisma/client"
import { prisma } from "@/src/lib/prisma"

/** Os estados que `RetificacaoPacote.status` já declarava. */
export const ESTADOS_DO_PACOTE = {
  EM_PREPARACAO: "em_preparacao",
  PROTOCOLADO: "protocolado",
  EM_EXIGENCIA: "em_exigencia",
  DECISAO_RECEBIDA: "decisao_recebida",
  VALIDADO: "validado",
  BLOQUEADO: "bloqueado",
  CANCELADO: "cancelado",
} as const
export type EstadoDoPacote = (typeof ESTADOS_DO_PACOTE)[keyof typeof ESTADOS_DO_PACOTE]

/** Encerrados: não geram mais trabalho, e por isso saem da materialização. */
export const ESTADOS_ENCERRADOS: string[] = [ESTADOS_DO_PACOTE.VALIDADO, ESTADOS_DO_PACOTE.CANCELADO]

/** Os dois modos que `RetificacaoPacote.tipo` sempre admitiu. */
export const MODOS_DE_RETIFICACAO = ["judicial", "administrativa"] as const
export type ModoDeRetificacao = (typeof MODOS_DE_RETIFICACAO)[number]

export interface PacoteAberto {
  pacoteId: number
  num: string
  jaExistia: boolean
}

/**
 * Abre um pedido de retificação com as divergências que ALGUÉM escolheu.
 *
 * A numeração é por processo (PR-001, PR-002…) e a trava é o índice único
 * `(processoId, num)`: dois pedidos abrindo ao mesmo tempo não recebem o mesmo número.
 */
export async function abrirPacoteDeRetificacao(args: {
  processoId: number
  tipo: ModoDeRetificacao
  divergenciaIds: number[]
  motivo?: string | null
  orgaoId?: number | null
  /** Reabrir o mesmo conjunto não deve criar um segundo pedido idêntico. */
  chaveDeIdempotencia?: string | null
}): Promise<PacoteAberto> {
  if (!MODOS_DE_RETIFICACAO.includes(args.tipo)) {
    throw new Error(`MODO_INVALIDO: "${args.tipo}" não é judicial nem administrativa.`)
  }
  const divergencias = [...new Set(args.divergenciaIds)]
  if (divergencias.length === 0) throw new Error("PACOTE_SEM_DIVERGENCIA")

  return prisma.$transaction(async (tx) => {
    // UMA DIVERGÊNCIA NÃO ENTRA EM DOIS PEDIDOS ABERTOS. Se entrasse, duas petições
    // pediriam a mesma correção e a segunda voltaria indeferida — e o sistema teria
    // deixado.
    const jaEmAberto = await tx.retificacaoPacoteDivergencia.findFirst({
      where: {
        divergenciaId: { in: divergencias },
        pacote: { processoId: args.processoId, status: { notIn: ESTADOS_ENCERRADOS } },
      },
      select: { divergenciaId: true, pacote: { select: { id: true, num: true } } },
    })
    if (jaEmAberto) {
      throw new Error(
        `DIVERGENCIA_JA_EM_PEDIDO: a divergência ${jaEmAberto.divergenciaId} já está no pedido ${jaEmAberto.pacote.num}.`,
      )
    }

    const quantos = await tx.retificacaoPacote.count({ where: { processoId: args.processoId } })
    const num = `PR-${String(quantos + 1).padStart(3, "0")}`

    const pacote = await tx.retificacaoPacote.create({
      data: {
        processoId: args.processoId,
        num,
        tipo: args.tipo,
        status: ESTADOS_DO_PACOTE.EM_PREPARACAO,
        motivo: args.motivo ?? null,
        orgaoId: args.orgaoId ?? null,
        divergencias: { create: divergencias.map((divergenciaId) => ({ divergenciaId })) },
      },
      select: { id: true, num: true },
    })
    return { pacoteId: pacote.id, num: pacote.num, jaExistia: false }
  }, { maxWait: 20_000, timeout: 120_000 })
}

/** As divergências de um pedido, pelo vínculo — nunca pelo snapshot. */
export async function divergenciasDoPacote(pacoteId: number) {
  const linhas = await prisma.retificacaoPacoteDivergencia.findMany({
    where: { pacoteId },
    select: {
      divergencia: {
        select: {
          id: true, campo: true, campoLabel: true, pessoaNome: true, documentoTitulo: true,
          valorArvore: true, valorDocumento: true, severidade: true, status: true,
        },
      },
    },
    orderBy: { divergenciaId: "asc" },
  })
  return linhas.map((l) => l.divergencia)
}

/** Os pedidos que ainda geram trabalho — é o que a materialização da fase enxerga. */
export async function pacotesAbertos(processoId: number, tx?: Prisma.TransactionClient) {
  return (tx ?? prisma).retificacaoPacote.findMany({
    where: { processoId, status: { notIn: ESTADOS_ENCERRADOS } },
    select: { id: true, num: true, tipo: true, status: true, orgaoId: true, protocoloId: true },
    orderBy: { id: "asc" },
  })
}

/**
 * Muda o estado do pedido. Recebe o estado — não o adivinha a partir dos passos:
 * quem sabe que a decisão saiu é quem registrou a decisão.
 */
export async function mudarEstadoDoPacote(
  pacoteId: number, estado: EstadoDoPacote, tx?: Prisma.TransactionClient,
): Promise<void> {
  await (tx ?? prisma).retificacaoPacote.update({ where: { id: pacoteId }, data: { status: estado } })
}
