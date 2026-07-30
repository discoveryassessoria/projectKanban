// src/services/registral/versionamento.ts
//
// MRG — versões genealógicas persistidas (requisito 15).
//
// Uma versão é um SNAPSHOT LÓGICO da árvore: identidade, vínculos, fatos ativos,
// aliases e a linha apurada. É o que permite comparar duas versões e reverter com
// segurança. Nunca é apagada por exclusão comum — é append-only por construção
// (unique (arvoreId, versao) e nenhum delete neste módulo).

import { prisma } from "@/lib/prisma"
import type { Prisma } from "@prisma/client"
import {
  compararSnapshots,
  hashDoSnapshot,
  montarSnapshot,
  planejarReversao,
  type ComparacaoVersoes,
  type OperacaoReversao,
  type SnapshotGenealogico,
} from "@/src/lib/genealogia/registral/versao"
import { apurarElegibilidade } from "@/src/lib/genealogia/registral/elegibilidade"
import { verificarIntegridade } from "@/src/lib/genealogia/registral/integridade"
import { auditar } from "./auditoria"
import { ACOES_AUDITORIA } from "./constantes"
import { carregarContexto, carregarPessoas, carregarUnioes, carregarFatos, carregarComprovacao, carregarParaSnapshot } from "./estado"

type DB = typeof prisma | Prisma.TransactionClient

/** Monta o snapshot atual da árvore. Não grava. */
export async function snapshotAtual(db: DB, arvoreId: number, processoId: number | null): Promise<SnapshotGenealogico> {
  const pessoas = await carregarPessoas(db, arvoreId)
  const pessoaIds = pessoas.map((p) => p.id)
  const unioes = await carregarUnioes(db, pessoaIds)
  const { fatos, aliases } = await carregarParaSnapshot(db, pessoaIds, unioes.map((u) => u.id))

  let linha: number[] = []
  let transmissorId: number | null = null
  let resultado: string | null = null

  if (processoId != null) {
    const ctx = await carregarContexto(db, processoId)
    const fatosIntegridade = await carregarFatos(db, pessoaIds, unioes.map((u) => u.id))
    const inconsistencias = verificarIntegridade({
      pessoas,
      unioes,
      requerenteIds: ctx?.requerenteIds ?? [],
      fatos: fatosIntegridade,
    })
    const eleg = apurarElegibilidade({
      pessoas,
      unioes,
      paisAlvo: ctx?.paisAlvo ?? null,
      requerenteId: ctx?.requerenteIds[0] ?? null,
      raizId: ctx?.raizId ?? null,
      comprovacaoPorPessoa: await carregarComprovacao(db, processoId, pessoaIds),
      inconsistencias,
    })
    linha = eleg.caminhoPrincipal?.ids ?? []
    transmissorId = eleg.ascendenteTransmissorId
    resultado = eleg.resultado
  }

  return montarSnapshot({
    arvoreId,
    pessoas,
    unioes,
    fatos,
    aliases,
    linha,
    ascendenteTransmissorId: transmissorId,
    resultadoLinhagem: resultado,
  })
}

export interface VersaoCriada {
  id: number
  versao: number
  hash: string
  /** true quando o snapshot é idêntico ao da última versão (nenhuma nova criada). */
  semMudanca: boolean
}

/**
 * Cria uma versão. Quando o snapshot é IDÊNTICO ao da última versão, não cria
 * outra — versão duplicada por reprocessamento poluiria o histórico sem informar
 * nada. Roda dentro da transação do chamador quando `db` é a transação.
 */
export async function criarVersao(
  db: DB,
  p: {
    arvoreId: number
    processoId: number | null
    motivo: string
    propostaId?: number | null
    correlationId?: string | null
    criadoPorId?: number | null
    /** Snapshot já montado (evita recalcular dentro da transação). */
    snapshot?: SnapshotGenealogico
  },
): Promise<VersaoCriada> {
  const snap = p.snapshot ?? (await snapshotAtual(db, p.arvoreId, p.processoId))
  const hash = hashDoSnapshot(snap)

  const ultima = await db.versaoGenealogica.findFirst({
    where: { arvoreId: p.arvoreId },
    orderBy: { versao: "desc" },
    select: { id: true, versao: true, hash: true },
  })

  if (ultima && ultima.hash === hash) {
    return { id: ultima.id, versao: ultima.versao, hash, semMudanca: true }
  }

  const versao = (ultima?.versao ?? 0) + 1
  const criada = await db.versaoGenealogica.create({
    data: {
      arvoreId: p.arvoreId,
      versao,
      motivo: p.motivo.slice(0, 200),
      snapshot: snap as unknown as Prisma.InputJsonValue,
      hash,
      propostaId: p.propostaId ?? null,
      correlationId: p.correlationId ?? null,
      criadoPorId: p.criadoPorId ?? null,
    },
    select: { id: true, versao: true },
  })

  await auditar(db, {
    acao: ACOES_AUDITORIA.VERSAO_CRIADA,
    entidade: "VersaoGenealogica",
    entidadeId: criada.id,
    descricao: `Versão ${criada.versao} da árvore ${p.arvoreId}: ${p.motivo}`,
    detalhes: {
      hash,
      pessoas: snap.pessoas.length,
      unioes: snap.unioes.length,
      fatos: snap.fatos.length,
      linha: snap.linha.length,
    },
    usuarioId: p.criadoPorId ?? null,
    correlationId: p.correlationId ?? null,
  })

  return { id: criada.id, versao: criada.versao, hash, semMudanca: false }
}

export async function lerVersao(db: DB, arvoreId: number, versao: number): Promise<SnapshotGenealogico | null> {
  const linha = await db.versaoGenealogica.findUnique({
    where: { arvoreId_versao: { arvoreId, versao } },
    select: { snapshot: true },
  })
  if (!linha) return null
  return linha.snapshot as unknown as SnapshotGenealogico
}

export async function listarVersoes(db: DB, arvoreId: number, limite = 50) {
  return db.versaoGenealogica.findMany({
    where: { arvoreId },
    orderBy: { versao: "desc" },
    take: limite,
    select: {
      id: true,
      versao: true,
      motivo: true,
      hash: true,
      propostaId: true,
      correlationId: true,
      criadoEm: true,
      criadoPor: { select: { id: true, nome: true } },
    },
  })
}

export async function compararVersoes(
  db: DB,
  arvoreId: number,
  de: number,
  para: number,
): Promise<{ comparacao: ComparacaoVersoes; erro: string | null }> {
  const a = await lerVersao(db, arvoreId, de)
  const b = await lerVersao(db, arvoreId, para)
  if (!a) return { comparacao: { iguais: true, mudancas: [], resumo: "" }, erro: `Versão ${de} não encontrada.` }
  if (!b) return { comparacao: { iguais: true, mudancas: [], resumo: "" }, erro: `Versão ${para} não encontrada.` }
  return { comparacao: compararSnapshots(a, b), erro: null }
}

/** Compara uma versão com o estado ATUAL da árvore. */
export async function compararComAtual(
  db: DB,
  arvoreId: number,
  processoId: number | null,
  versao: number,
): Promise<{ comparacao: ComparacaoVersoes; erro: string | null }> {
  const alvo = await lerVersao(db, arvoreId, versao)
  if (!alvo) return { comparacao: { iguais: true, mudancas: [], resumo: "" }, erro: `Versão ${versao} não encontrada.` }
  const atual = await snapshotAtual(db, arvoreId, processoId)
  return { comparacao: compararSnapshots(alvo, atual), erro: null }
}

/** Plano de reversão até uma versão — declarativo, para o serviço de reversão aplicar. */
export async function planoDeReversao(
  db: DB,
  arvoreId: number,
  processoId: number | null,
  versaoAlvo: number,
): Promise<{ operacoes: OperacaoReversao[]; impossivel: string[]; erro: string | null }> {
  const alvo = await lerVersao(db, arvoreId, versaoAlvo)
  if (!alvo) return { operacoes: [], impossivel: [], erro: `Versão ${versaoAlvo} não encontrada.` }
  const atual = await snapshotAtual(db, arvoreId, processoId)
  const plano = planejarReversao(atual, alvo)
  return { ...plano, erro: null }
}
