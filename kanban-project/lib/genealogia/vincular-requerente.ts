// lib/genealogia/vincular-requerente.ts
// ============================================================================
// CORE do DEDUP: vincular um Requerente (participante oficial do Processo) como
// nó da Árvore Genealógica REUSANDO a Pessoa existente — nunca criando duplicata.
//
// Invariante: um Requerente com `personId` setado NUNCA gera uma segunda Pessoa.
//   - Se o Requerente já tem `personId` → REUSA essa Pessoa (adota na árvore se
//     estiver solta; 409 se pertence a OUTRA árvore; idempotente se já é nó desta).
//   - Se o Requerente NÃO tem `personId` → cria UMA Pessoa a partir dos dados-mestre
//     e IMEDIATAMENTE grava `Requerente.personId` (o vínculo impede 2ª criação).
//
// Este é o ÚNICO ponto que cria Pessoa para um requerente. Função pura testável
// (opera dentro de uma transação); a rota apenas a chama e dispara efeitos externos.
// ============================================================================

import type { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"

export type VincularRequerenteErro =
  | "ARVORE_NAO_ENCONTRADA"
  | "REQUERENTE_NAO_ENCONTRADO"
  | "PESSOA_EM_OUTRA_ARVORE"

export interface VincularRequerenteInput {
  arvoreId: number
  requerenteId: number
  x?: number | null
  y?: number | null
  paiId?: number | null
  maeId?: number | null
}

export type VincularRequerenteResult =
  | { ok: true; pessoaId: number; criada: boolean }
  | { ok: false; code: VincularRequerenteErro; message: string }

/** Deriva nome/sobrenome a partir do nome completo do Requerente (1ª palavra = nome). */
function splitNome(nomeCompleto: string): { nome: string; sobrenome: string | null } {
  const limpo = (nomeCompleto ?? "").trim()
  const partes = limpo.split(/\s+/).filter(Boolean)
  if (partes.length <= 1) return { nome: partes[0] || limpo || "Requerente", sobrenome: null }
  return { nome: partes[0], sobrenome: partes.slice(1).join(" ") }
}

/** Monta o patch de posição/vínculos só com os campos efetivamente enviados. */
function posicaoEVinculos(input: VincularRequerenteInput): Record<string, unknown> {
  const data: Record<string, unknown> = {}
  if (input.x !== undefined) data.x = input.x
  if (input.y !== undefined) data.y = input.y
  if (input.paiId !== undefined) data.paiId = input.paiId
  if (input.maeId !== undefined) data.maeId = input.maeId
  return data
}

/**
 * Lógica central (dentro de transação). Retorna a Pessoa reusada/criada e se houve
 * criação. NÃO dispara eventos de domínio nem materialização — isso é da rota.
 */
export async function vincularRequerenteTx(
  tx: Prisma.TransactionClient,
  input: VincularRequerenteInput
): Promise<VincularRequerenteResult> {
  const { arvoreId, requerenteId } = input

  const arvore = await tx.arvore.findUnique({
    where: { id: arvoreId },
    select: { id: true, pessoaPrincipalId: true },
  })
  if (!arvore) {
    return { ok: false, code: "ARVORE_NAO_ENCONTRADA", message: "Árvore não encontrada" }
  }

  const requerente = await tx.requerente.findUnique({
    where: { id: requerenteId },
    select: {
      id: true,
      nome: true,
      sexo: true,
      dataNascimento: true,
      nacionalidade: true,
      pais: true,
      personId: true,
    },
  })
  if (!requerente) {
    return { ok: false, code: "REQUERENTE_NAO_ENCONTRADO", message: "Requerente não encontrado" }
  }

  // Auto-principal: se NENHUMA Pessoa desta árvore é "maior", esta vira o principal
  // ("maior"); caso contrário entra como requerente comum ("sim").
  const jaTemPrincipal =
    (await tx.pessoa.count({ where: { arvoreId, requerente: "maior" } })) > 0
  const flagRequerente = jaTemPrincipal ? "sim" : "maior"

  const patchPosicao = posicaoEVinculos(input)

  // ── REUSA a Pessoa já vinculada ao Requerente ──────────────────────────────
  if (requerente.personId != null) {
    const pessoa = await tx.pessoa.findUnique({
      where: { id: requerente.personId },
      select: { id: true, arvoreId: true },
    })

    // Vínculo consistente: a Pessoa existe.
    if (pessoa) {
      if (pessoa.arvoreId === arvoreId) {
        // Idempotente: já é nó DESTA árvore. Só atualiza posição/vínculos se enviados.
        if (Object.keys(patchPosicao).length > 0) {
          await tx.pessoa.update({ where: { id: pessoa.id }, data: patchPosicao })
        }
        return { ok: true, pessoaId: pessoa.id, criada: false }
      }

      if (pessoa.arvoreId != null) {
        // Pertence a OUTRA árvore — não movemos à força.
        return {
          ok: false,
          code: "PESSOA_EM_OUTRA_ARVORE",
          message:
            "Esta pessoa já é nó de outra árvore genealógica; não é possível movê-la automaticamente.",
        }
      }

      // Pessoa solta (arvoreId null) → adota nesta árvore, sem criar nova.
      await tx.pessoa.update({
        where: { id: pessoa.id },
        data: { arvoreId, requerente: flagRequerente, ...patchPosicao },
      })
      if (arvore.pessoaPrincipalId == null) {
        await tx.arvore.update({ where: { id: arvore.id }, data: { pessoaPrincipalId: pessoa.id } })
      }
      return { ok: true, pessoaId: pessoa.id, criada: false }
    }
    // personId aponta para Pessoa inexistente (dado órfão) → cai no caminho de criação
    // abaixo e re-vincula, ainda garantindo no máximo UMA Pessoa viva por requerente.
  }

  // ── CRIA a Pessoa (ÚNICO ponto) e VINCULA o Requerente ─────────────────────
  const { nome, sobrenome } = splitNome(requerente.nome)
  const nova = await tx.pessoa.create({
    data: {
      nome,
      sobrenome,
      sexo: requerente.sexo ?? null,
      data_nasc: requerente.dataNascimento ?? null,
      nacionalidade: requerente.nacionalidade ?? null,
      pais_nasc: requerente.pais ?? null,
      arvoreId,
      requerente: flagRequerente,
      x: input.x ?? null,
      y: input.y ?? null,
      paiId: input.paiId ?? null,
      maeId: input.maeId ?? null,
    },
    select: { id: true },
  })

  await tx.requerente.update({ where: { id: requerenteId }, data: { personId: nova.id } })

  if (arvore.pessoaPrincipalId == null) {
    await tx.arvore.update({ where: { id: arvore.id }, data: { pessoaPrincipalId: nova.id } })
  }

  return { ok: true, pessoaId: nova.id, criada: true }
}

/** Wrapper transacional usado pela rota HTTP (e pelo teste de invariante). */
export async function vincularRequerente(
  input: VincularRequerenteInput
): Promise<VincularRequerenteResult> {
  return prisma.$transaction((tx) => vincularRequerenteTx(tx, input))
}
