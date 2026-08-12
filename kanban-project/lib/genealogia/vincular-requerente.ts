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
// Este é o ÚNICO ponto que cria Pessoa para um requerente.
//
// ─── O EFEITO DE DOMÍNIO É DAQUI, NÃO DA ROTA ───────────────────────────────
// Até 09/08/2026 esta função criava o vínculo e PARAVA. O evento
// `requerente.adicionado` — que dispara o motor financeiro — e a reavaliação das
// Regras Documentais eram disparados pela ROTA HTTP, depois de chamar aqui.
//
// Resultado: duas portas para o mesmo ato, com estados finais diferentes.
//   pela tela   → vínculo + evento + materialização (e cobrança)
//   por serviço → só o vínculo
//
// Medido em produção: os requerentes 134, 135 e 137 do processo 513 tiveram nó de
// árvore e NUNCA geraram `MotorArtefato` — as únicas chaves `::req:` do processo
// são de quem entrou pela tela. Ninguém errou; a porta é que era outra.
//
// Agora o ato inteiro pertence a este arquivo:
//   `vincularRequerenteTx`        vínculo + ENFILEIRA o evento, na MESMA transação;
//   `efeitosDoVinculoPosCommit`   drena a fila + reavalia as Regras Documentais;
//   `vincularRequerente`          faz os dois — é a porta pública.
//
// A rota não decide mais nada: ela traduz HTTP e chama a porta pública.
// ============================================================================

import type { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import {
  enfileirarEventoRequerente,
  TIPO_EVENTO_REQUERENTE,
} from "@/src/services/genealogia/emitir-evento-requerente"
import { processarOutbox } from "@/src/services/outbox-dispatcher"
import { dispararMaterializacaoPorArvore } from "@/src/services/genealogia/materializar-genealogia"

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
  /** Quem executou o ato — vai no evento de domínio. Nunca decide nada. */
  actorId?: number | null
  /** Correlação para seguir o ato pelos logs até o efeito financeiro. */
  correlationId?: string | null
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
 * Só o VÍNCULO — reuso/adoção/criação do nó. Interna de propósito: chamar isto
 * sem enfileirar o evento é exatamente a segunda porta que este arquivo fechou.
 */
async function aplicarVinculoNaArvore(
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
      select: { id: true, arvoreId: true, removidaEm: true },
    })

    // Vínculo consistente: a Pessoa existe.
    if (pessoa) {
      if (pessoa.arvoreId === arvoreId) {
        // REINSERÇÃO: o nó existe mas estava removido com histórico preservado.
        // Reativar é obrigatório — criar um segundo nó seria exatamente a
        // duplicação que este fluxo existe para impedir. `criar → excluir →
        // recriar` é cenário suportado, não exceção.
        if (pessoa.removidaEm != null) {
          await tx.pessoa.update({
            where: { id: pessoa.id },
            data: { removidaEm: null, removidaPorId: null, motivoRemocao: null, requerente: flagRequerente },
          })
          await tx.processoRequerente.updateMany({
            where: { requerenteId, removidoEm: { not: null } },
            data: { removidoEm: null, removidoPorId: null, motivoRemocao: null },
          })
        }
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
        data: {
          arvoreId, requerente: flagRequerente, ...patchPosicao,
          removidaEm: null, removidaPorId: null, motivoRemocao: null,
        },
      })
      await tx.processoRequerente.updateMany({
        where: { requerenteId, removidoEm: { not: null } },
        data: { removidoEm: null, removidoPorId: null, motivoRemocao: null },
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

// ═══════════════════════════════════════════════════════════════════════════
// O ATO COMPLETO — vínculo + efeito de domínio.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * VÍNCULO + EVENTO, na MESMA transação. Use quando você já tem uma transação
 * aberta e precisa compor. O enfileiramento é atômico com o vínculo: ou os dois
 * existem, ou nenhum — nunca um nó de árvore sem o evento que o cobra.
 *
 * SAÍDA OBRIGATÓRIA: quem chama isto PRECISA chamar `efeitosDoVinculoPosCommit`
 * depois do commit. Sem isso o evento fica PENDENTE até o dispatcher passar, e o
 * estado converge tarde em vez de na hora. O guard reprova quem esquecer.
 *
 * ENFILEIRA SEMPRE, inclusive na chamada idempotente sobre nó que já existe: a
 * dedup é da chave (`req.add::{processo}::{pessoa}`, `@unique` na DomainOutbox),
 * não de um `if` daqui. Assim toda porta chega ao mesmo lugar e repetir é grátis.
 */
export async function vincularRequerenteTx(
  tx: Prisma.TransactionClient,
  input: VincularRequerenteInput
): Promise<VincularRequerenteResult> {
  const resultado = await aplicarVinculoNaArvore(tx, input)
  if (!resultado.ok) return resultado

  await enfileirarEventoRequerente(tx, {
    pessoaId: resultado.pessoaId,
    arvoreId: input.arvoreId,
    actorId: input.actorId ?? null,
    correlationId: input.correlationId ?? null,
  })

  return resultado
}

/**
 * Os efeitos que só podem rodar DEPOIS do commit — porque leem o que a transação
 * gravou e abrem transações próprias.
 *
 * Best-effort por construção: o vínculo já está persistido e não pode ser desfeito
 * por uma falha aqui. O que falha fica PENDENTE na outbox e o dispatcher reprocessa;
 * é o contrato do Outbox, não uma desculpa.
 */
export async function efeitosDoVinculoPosCommit(
  args: { arvoreId: number | null },
): Promise<{ drenado: boolean; materializado: boolean; erros: string[] }> {
  const erros: string[] = []
  if (args.arvoreId == null) return { drenado: false, materializado: false, erros }

  let drenado = false
  try {
    await processarOutbox({ tipos: [TIPO_EVENTO_REQUERENTE], limite: 20 })
    drenado = true
  } catch (e) {
    erros.push(`drenagem do evento: ${e instanceof Error ? e.message : String(e)}`)
  }

  let materializado = false
  try {
    await dispararMaterializacaoPorArvore(args.arvoreId)
    materializado = true
  } catch (e) {
    erros.push(`materialização da árvore ${args.arvoreId}: ${e instanceof Error ? e.message : String(e)}`)
  }

  if (erros.length) console.error("[vínculo de requerente → efeitos]", erros.join(" ; "))
  return { drenado, materializado, erros }
}

/**
 * A PORTA PÚBLICA. Transação própria + efeitos pós-commit. É o que a rota, o
 * script, o backfill e o teste devem chamar — todos terminam no mesmo estado.
 */
export async function vincularRequerente(
  input: VincularRequerenteInput
): Promise<VincularRequerenteResult> {
  const resultado = await prisma.$transaction((tx) => vincularRequerenteTx(tx, input))
  if (resultado.ok) await efeitosDoVinculoPosCommit({ arvoreId: input.arvoreId })
  return resultado
}

/**
 * A OUTRA entrada para o MESMO efeito: a Pessoa já existe na árvore e o seu flag
 * `requerente` passou de não para sim (edição do nó, em `PUT /api/pessoas/[id]`).
 * Não há vínculo a criar — há o mesmo evento a emitir, pela mesma régua.
 *
 * Existe para que a rota não precise conhecer a DomainOutbox. Se amanhã "virar
 * requerente" ganhar um segundo efeito, ele entra aqui e as duas entradas o herdam.
 */
export async function registrarTransicaoParaRequerenteTx(
  tx: Prisma.TransactionClient,
  args: { pessoaId: number; arvoreId: number; actorId?: number | null; correlationId?: string | null },
): Promise<void> {
  await enfileirarEventoRequerente(tx, {
    pessoaId: args.pessoaId,
    arvoreId: args.arvoreId,
    actorId: args.actorId ?? null,
    correlationId: args.correlationId ?? null,
  })
}
