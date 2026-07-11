// src/services/necessidade-documental.ts
// CP-3 — service da NecessidadeDocumental (idempotente, dual-read, append-only).
//
// Cadeia: Documento Mestre (ItemCatalogo) -> NecessidadeDocumental ->
// Documento Operacional -> ... Geração idempotente pela Árvore e pela Matriz.
// Sem dual-write: grava só nos models novos. Nada legado é removido.

import { prisma } from "@/lib/prisma"
import type { Prisma } from "@prisma/client"
import { montarChaveIdempotencia } from "@/src/services/necessidade-documental-helpers"
import { codeDocumentoMestre } from "@/src/services/catalogo-helpers"
import { analyzePessoa, DOCUMENT_RULES } from "@/src/lib/document-generator"

export { montarChaveIdempotencia, sujeitoValido } from "@/src/services/necessidade-documental-helpers"

type DB = typeof prisma | Prisma.TransactionClient

export interface GarantirNecessidadeInput {
  processoId: number
  itemCatalogoId: number
  pessoaId?: number | null
  uniaoId?: number | null
  varianteKey?: string
  ciclo?: number
  origem?: "ARVORE" | "MATRIZ" | "MANUAL" | "MIGRACAO"
  obrigatoriedade?: "OBRIGATORIA" | "OPCIONAL"
  matrizRegraId?: number | null
  matrizRegraVersao?: number | null
  matrizSnapshot?: Prisma.InputJsonValue | null
  motivoAplicabilidade?: string | null
  arvoreId?: number | null
  ruleCode?: string | null
}

/** Cria a necessidade se não existir (idempotente por chaveIdempotencia). */
export async function garantirNecessidade(input: GarantirNecessidadeInput, db: DB = prisma) {
  const chaveIdempotencia = montarChaveIdempotencia(input) // lança se XOR inválido

  const existente = await db.necessidadeDocumental.findUnique({ where: { chaveIdempotencia } })
  if (existente) return { necessidade: existente, criada: false }

  try {
    const necessidade = await db.necessidadeDocumental.create({
      data: {
        processoId: input.processoId,
        itemCatalogoId: input.itemCatalogoId,
        pessoaId: input.pessoaId ?? null,
        uniaoId: input.uniaoId ?? null,
        varianteKey: input.varianteKey || "padrao",
        ciclo: input.ciclo && input.ciclo > 0 ? input.ciclo : 1,
        chaveIdempotencia,
        origem: input.origem || "MANUAL",
        obrigatoriedade: input.obrigatoriedade || "OBRIGATORIA",
        status: "PENDENTE",
        matrizRegraId: input.matrizRegraId ?? null,
        matrizRegraVersao: input.matrizRegraVersao ?? null,
        matrizSnapshot: input.matrizSnapshot ?? undefined,
        avaliadaEm: input.matrizRegraId != null ? new Date() : null,
        motivoAplicabilidade: input.motivoAplicabilidade ?? null,
        arvoreId: input.arvoreId ?? null,
        ruleCode: input.ruleCode ?? null,
      },
    })
    await db.necessidadeDocumentalEvento.create({
      data: { necessidadeId: necessidade.id, tipo: "CRIADA", dados: { origem: necessidade.origem } },
    })
    return { necessidade, criada: true }
  } catch (e) {
    // Corrida: outra transação criou a mesma chave.
    if ((e as { code?: string })?.code === "P2002") {
      const necessidade = await db.necessidadeDocumental.findUnique({ where: { chaveIdempotencia } })
      if (necessidade) return { necessidade, criada: false }
    }
    throw e
  }
}

/** DUAL-READ: necessidade de um documento (necessidadeId direto ou derivada). */
export async function resolverNecessidadeDeDocumento(
  doc: { necessidadeId?: number | null; pessoaId?: number | null; documentTypeId?: number | null },
  db: DB = prisma
) {
  if (doc.necessidadeId != null) {
    return db.necessidadeDocumental.findUnique({ where: { id: doc.necessidadeId } })
  }
  // Fallback legado: casar por pessoa + itemCatalogo do tipo do documento.
  if (doc.pessoaId != null && doc.documentTypeId != null) {
    const cad = await db.tipoDocumentoCadastro.findUnique({
      where: { id: doc.documentTypeId },
      select: { itemCatalogoId: true },
    })
    if (cad?.itemCatalogoId) {
      const cands = await db.necessidadeDocumental.findMany({
        where: { pessoaId: doc.pessoaId, itemCatalogoId: cad.itemCatalogoId },
        orderBy: { ciclo: "desc" },
        take: 2,
      })
      if (cands.length === 1) return cands[0]
    }
  }
  return null
}

async function evento(
  db: DB,
  necessidadeId: number,
  tipo: "CRIADA" | "EM_ATENDIMENTO" | "ATENDIDA" | "NAO_LOCALIZADA" | "REABERTA" | "DISPENSADA" | "SUPERSEDIDA" | "RETORNO_GENEALOGIA",
  dados?: Prisma.InputJsonValue
) {
  await db.necessidadeDocumentalEvento.create({ data: { necessidadeId, tipo, dados: dados ?? undefined } })
}

/** Documento não localizado: preserva histórico, marca a necessidade. */
export async function marcarNaoLocalizada(necessidadeId: number, db: DB = prisma) {
  const n = await db.necessidadeDocumental.update({
    where: { id: necessidadeId },
    data: { status: "NAO_LOCALIZADA" },
  })
  await evento(db, necessidadeId, "NAO_LOCALIZADA")
  return n
}

/** Retorno controlado à Genealogia (append-only; não apaga histórico). */
export async function retornoGenealogia(necessidadeId: number, motivo?: string, db: DB = prisma) {
  await evento(db, necessidadeId, "RETORNO_GENEALOGIA", motivo ? { motivo } : undefined)
  return db.necessidadeDocumental.findUnique({ where: { id: necessidadeId } })
}

/**
 * Reabre: cria uma NOVA necessidade (ciclo+1, nova chave) e preserva a anterior
 * marcando-a como superseded. Histórico append-only.
 */
export async function reabrir(necessidadeId: number, db: DB = prisma) {
  const atual = await db.necessidadeDocumental.findUnique({ where: { id: necessidadeId } })
  if (!atual) throw new Error(`Necessidade ${necessidadeId} não encontrada`)

  const { necessidade: nova } = await garantirNecessidade(
    {
      processoId: atual.processoId,
      itemCatalogoId: atual.itemCatalogoId,
      pessoaId: atual.pessoaId,
      uniaoId: atual.uniaoId,
      varianteKey: atual.varianteKey,
      ciclo: atual.ciclo + 1,
      origem: atual.origem,
      obrigatoriedade: atual.obrigatoriedade,
      matrizRegraId: atual.matrizRegraId,
      matrizRegraVersao: atual.matrizRegraVersao,
      arvoreId: atual.arvoreId,
      ruleCode: atual.ruleCode,
    },
    db
  )

  await db.necessidadeDocumental.update({ where: { id: atual.id }, data: { supersedePorId: nova.id } })
  await evento(db, atual.id, "REABERTA", { novaId: nova.id, ciclo: nova.ciclo })
  await evento(db, atual.id, "SUPERSEDIDA", { novaId: nova.id })
  return nova
}

// ============================================================
// Geração idempotente — ÁRVORE e MATRIZ
// ============================================================

async function resolverItemCatalogoDeEnum(enumValue: string, db: DB): Promise<number | null> {
  const cad = await db.tipoDocumentoCadastro.findUnique({
    where: { legacyEnumKey: enumValue },
    select: { itemCatalogoId: true },
  })
  if (cad?.itemCatalogoId) return cad.itemCatalogoId
  const item = await db.itemCatalogo.findUnique({ where: { code: codeDocumentoMestre(enumValue) }, select: { id: true } })
  return item?.id ?? null
}

async function resolverItemCatalogoDeCode(code: string, db: DB): Promise<number | null> {
  const cad = await db.tipoDocumentoCadastro.findFirst({
    where: { code },
    select: { itemCatalogoId: true },
  })
  if (cad?.itemCatalogoId) return cad.itemCatalogoId
  const item = await db.itemCatalogo.findUnique({ where: { code }, select: { id: true } })
  return item?.id ?? null
}

async function resolverUniaoUnica(pessoaId: number, db: DB): Promise<number | null> {
  const unioes = await db.uniao.findMany({
    where: { OR: [{ pessoa1Id: pessoaId }, { pessoa2Id: pessoaId }] },
    select: { id: true },
  })
  return unioes.length === 1 ? unioes[0].id : null
}

/** Gera necessidades a partir da ÁRVORE do processo (regras NASC/CAS/OBT). */
export async function garantirNecessidadesArvoreDoProcesso(processoId: number, db: DB = prisma) {
  const proc = await db.processo.findUnique({ where: { id: processoId }, select: { id: true, arvoreId: true } })
  if (!proc?.arvoreId) return { criadas: 0, puladas: 0 }

  const pessoas = await db.pessoa.findMany({
    where: { arvoreId: proc.arvoreId },
    select: { id: true, nome: true, sobrenome: true, casado: true, vivo: true },
  })

  let criadas = 0
  let puladas = 0
  for (const p of pessoas) {
    const flags = analyzePessoa({ id: p.id, nome: p.nome, sobrenome: p.sobrenome, casado: p.casado, vivo: p.vivo })
    for (const rule of DOCUMENT_RULES) {
      if (!flags[rule.flag]) continue
      const itemCatalogoId = await resolverItemCatalogoDeEnum(rule.tipo, db)
      if (!itemCatalogoId) {
        puladas++
        continue
      }
      // Casamento -> sujeito UNIÃO; nascimento/óbito -> sujeito PESSOA.
      let sujeito: { pessoaId?: number; uniaoId?: number }
      if (rule.code === "CAS_IT") {
        const uniaoId = await resolverUniaoUnica(p.id, db)
        if (!uniaoId) {
          puladas++ // sem união única — não inventar vínculo (Regra 11)
          continue
        }
        sujeito = { uniaoId }
      } else {
        sujeito = { pessoaId: p.id }
      }
      const { criada } = await garantirNecessidade(
        { processoId, itemCatalogoId, ...sujeito, origem: "ARVORE", ruleCode: rule.code, arvoreId: proc.arvoreId },
        db
      )
      if (criada) criadas++
    }
  }
  return { criadas, puladas }
}

/** Gera necessidades a partir da MATRIZ documental (snapshot da regra+versão). */
export async function garantirNecessidadesDaMatriz(processoId: number, phaseKey: string | null = null, db: DB = prisma) {
  const proc = await db.processo.findUnique({
    where: { id: processoId },
    select: { id: true, arvoreId: true, tipoProcessoMotorId: true },
  })
  if (!proc?.tipoProcessoMotorId) return { criadas: 0, puladas: 0 }

  const regras = await db.matrizDocumental.findMany({
    where: {
      tipoProcessoId: proc.tipoProcessoMotorId,
      arquivado: false,
      ...(phaseKey ? { OR: [{ phaseKey }, { phaseKey: null }] } : {}),
    },
  })

  const pessoas = proc.arvoreId
    ? await db.pessoa.findMany({ where: { arvoreId: proc.arvoreId, linhaReta: true }, select: { id: true } })
    : []

  let criadas = 0
  let puladas = 0
  for (const r of regras) {
    const itemCatalogoId = await resolverItemCatalogoDeCode(r.documentTypeCode, db)
    if (!itemCatalogoId) {
      puladas++
      continue
    }
    const snapshot = {
      matrizRegraId: r.id,
      versao: r.versao,
      target: r.target,
      generationRule: r.generationRule,
      condition: r.condition ?? null,
    }
    for (const p of pessoas) {
      const { criada } = await garantirNecessidade(
        {
          processoId,
          itemCatalogoId,
          pessoaId: p.id,
          origem: "MATRIZ",
          obrigatoriedade: r.required ? "OBRIGATORIA" : "OPCIONAL",
          matrizRegraId: r.id,
          matrizRegraVersao: r.versao,
          matrizSnapshot: snapshot,
          motivoAplicabilidade: r.condition ?? null,
          arvoreId: proc.arvoreId,
        },
        db
      )
      if (criada) criadas++
    }
  }
  return { criadas, puladas }
}
