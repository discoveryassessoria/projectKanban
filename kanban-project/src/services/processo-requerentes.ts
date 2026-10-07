// src/services/processo-requerentes.ts
// ============================================================================
// O DONO ÚNICO DO VÍNCULO REQUERENTE × PESSOA × PROCESSO (07/10/2026).
//
// Três campos formam UM fato — «esta pessoa da árvore é requerente deste processo» — e só este serviço os escreve:
//   • ProcessoRequerente        (o requerente está no processo; `removidoEm` = saiu, com histórico),
//   • Requerente.personId       (o requerente aponta para o nó dele na árvore),
//   • Pessoa.requerente         (o nó da árvore sabe que é requerente: sim / maior / menor; nao = não é).
// Antes, 6 caminhos escreviam isso cada um do seu jeito (o PUT do processo apagava tudo e recriava; o «Vincular à árvore» gravava só o ponteiro; a
// exclusão, a desativação, a coleta e a criação do processo tinham a sua). O vínculo ao processo só valia ao salvar o modal, e a Christine Abellan foi
// requerente da árvore sem estar no processo.
//
// REGRAS (valem em TODO caminho, no servidor):
//   1. O requerente só entra na árvore (personId / flag) se estiver ATIVO em um processo daquela árvore → `REQUERENTE_FORA_DO_PROCESSO_DA_ARVORE`.
//   2. Atualizar a lista de requerentes de um processo é um DIFF: entra quem faltava, sai quem não está mais; ninguém é apagado — quem sai fica com
//      `removidoEm` (histórico preservado) e a pessoa dele deixa de ser requerente na árvore (flag «nao»); quem volta é reativado.
//   3. Uma transação por operação; o chamador que já tem transação passa o `tx`.
//   4. `scripts/vinculo-requerente-servico-unico.test.ts` reprova qualquer escrita nesses campos fora deste arquivo.
// ============================================================================
import type { Prisma, PrismaClient } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { PESSOA_ATIVA, REATIVAR_VINCULO_PROCESSO, VINCULO_PROCESSO_ATIVO } from "@/src/lib/genealogia/vinculo-ativo"

type DB = PrismaClient | Prisma.TransactionClient

export type CodigoDeVinculoRecusado =
  | "REQUERENTE_FORA_DO_PROCESSO_DA_ARVORE"
  | "PESSOA_SEM_ARVORE"
  | "PESSOA_NAO_ENCONTRADA"
  | "REQUERENTE_NAO_ENCONTRADO"
  | "REQUERENTE_SEM_PESSOA"
  | "PROCESSO_NAO_ENCONTRADO"

export class VinculoRecusado extends Error {
  constructor(public codigo: CodigoDeVinculoRecusado, mensagem: string) { super(mensagem); this.name = "VinculoRecusado" }
}

export const FLAGS_DE_REQUERENTE = ["sim", "maior", "menor"] as const
export const ehFlagDeRequerente = (v: string | null | undefined): boolean => FLAGS_DE_REQUERENTE.includes(String(v ?? "").toLowerCase() as never)

const MSG_FORA_DO_PROCESSO = "Este requerente ainda não está no processo desta árvore. Marque-o no processo e salve antes de ligá-lo a uma pessoa da árvore."

// ─── guardas ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** O requerente está ATIVO em algum processo cuja árvore é `arvoreId`? */
export async function requerenteEstaNoProcessoDaArvore(db: DB, requerenteId: number, arvoreId: number): Promise<boolean> {
  return (await db.processoRequerente.count({ where: { requerenteId, ...VINCULO_PROCESSO_ATIVO, processo: { arvoreId } } })) > 0
}

export async function exigirRequerenteNoProcessoDaArvore(db: DB, requerenteId: number, arvoreId: number): Promise<void> {
  if (!(await requerenteEstaNoProcessoDaArvore(db, requerenteId, arvoreId))) throw new VinculoRecusado("REQUERENTE_FORA_DO_PROCESSO_DA_ARVORE", MSG_FORA_DO_PROCESSO)
}

// ─── Requerente.personId ──────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Aponta o requerente para o nó dele na árvore (ou solta o ponteiro com `null`). Apontar exige a pessoa numa árvore E o requerente ativo num processo
 * DESSA árvore (regra 1). Soltar nunca é recusado.
 */
export async function definirPessoaDoRequerente(db: DB, requerenteId: number, personId: number | null): Promise<void> {
  if (personId == null) { await db.requerente.update({ where: { id: requerenteId }, data: { personId: null } }); return }
  const pessoa = await db.pessoa.findUnique({ where: { id: personId }, select: { arvoreId: true } })
  if (!pessoa) throw new VinculoRecusado("PESSOA_NAO_ENCONTRADA", "Pessoa não encontrada.")
  if (pessoa.arvoreId == null) throw new VinculoRecusado("PESSOA_SEM_ARVORE", "A pessoa precisa estar numa árvore para ser ligada a um requerente.")
  await exigirRequerenteNoProcessoDaArvore(db, requerenteId, pessoa.arvoreId)
  await db.requerente.update({ where: { id: requerenteId }, data: { personId } })
}

// ─── Pessoa.requerente ────────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Marca (sim/maior/menor) ou desmarca («nao») a pessoa como requerente. Marcar exige um Requerente apontando para ela E ativo num processo da árvore dela.
 * `maior` é o requerente principal da árvore: se a árvore ainda não tem um, o primeiro vira `maior` e os seguintes `sim` (use `automatico`).
 */
export async function definirFlagDaPessoa(db: DB, pessoaId: number, flag: string, opts: { automatico?: boolean } = {}): Promise<string> {
  const normal = String(flag ?? "nao").toLowerCase()
  if (!ehFlagDeRequerente(normal)) { await db.pessoa.update({ where: { id: pessoaId }, data: { requerente: "nao" } }); return "nao" }
  const pessoa = await db.pessoa.findUnique({ where: { id: pessoaId }, select: { arvoreId: true } })
  if (!pessoa) throw new VinculoRecusado("PESSOA_NAO_ENCONTRADA", "Pessoa não encontrada.")
  if (pessoa.arvoreId == null) throw new VinculoRecusado("PESSOA_SEM_ARVORE", "A pessoa precisa estar numa árvore para ser requerente.")
  const requerente = await db.requerente.findFirst({ where: { personId: pessoaId }, select: { id: true } })
  if (!requerente) throw new VinculoRecusado("REQUERENTE_SEM_PESSOA", "Esta pessoa não está ligada a nenhum requerente.")
  await exigirRequerenteNoProcessoDaArvore(db, requerente.id, pessoa.arvoreId)
  let final = normal
  if (opts.automatico) final = (await db.pessoa.count({ where: { arvoreId: pessoa.arvoreId, requerente: "maior", id: { not: pessoaId } } })) > 0 ? "sim" : "maior"
  await db.pessoa.update({ where: { id: pessoaId }, data: { requerente: final } })
  return final
}

// ─── ProcessoRequerente ───────────────────────────────────────────────────────────────────────────────────────────────────────

/** Coloca os requerentes no processo: cria o vínculo que falta e REATIVA o que tinha saído (nunca duplica, nunca apaga histórico). */
export async function incluirNoProcesso(db: DB, processoId: number, requerenteIds: number[]): Promise<{ criados: number; reativados: number }> {
  let criados = 0, reativados = 0
  for (const requerenteId of [...new Set(requerenteIds)]) {
    const atual = await db.processoRequerente.findUnique({ where: { processoId_requerenteId: { processoId, requerenteId } }, select: { removidoEm: true } })
    if (!atual) { await db.processoRequerente.create({ data: { processoId, requerenteId } }); criados++ }
    else if (atual.removidoEm != null) {
      await db.processoRequerente.update({ where: { processoId_requerenteId: { processoId, requerenteId } }, data: REATIVAR_VINCULO_PROCESSO })
      reativados++
    }
  }
  return { criados, reativados }
}

/** Tira o requerente do processo SEM apagar: o vínculo fica com `removidoEm` (é ele que amarra o fato preservado ao processo). */
export async function retirarDoProcesso(db: DB, processoId: number | number[], requerenteId: number, quem: { porId?: number | null; motivo?: string | null } = {}): Promise<number> {
  const ids = Array.isArray(processoId) ? processoId : [processoId]
  if (!ids.length) return 0
  return (await db.processoRequerente.updateMany({
    where: { requerenteId, processoId: { in: ids }, ...VINCULO_PROCESSO_ATIVO },
    data: { removidoEm: new Date(), removidoPorId: quem.porId ?? null, motivoRemocao: quem.motivo?.slice(0, 300) ?? null },
  })).count
}

/** Apaga o vínculo de verdade — só para a EXCLUSÃO definitiva da pessoa (sem fato protegido). Tudo o mais usa `retirarDoProcesso`. */
export async function apagarVinculosDoRequerente(db: DB, requerenteId: number, processoIds: number[]): Promise<number> {
  if (!processoIds.length) return 0
  return (await db.processoRequerente.deleteMany({ where: { requerenteId, processoId: { in: processoIds } } })).count
}

/** Reativa os vínculos removidos do requerente nos processos de UMA árvore (a reinserção do nó). Idempotente. */
export async function reativarVinculosNaArvore(db: DB, requerenteId: number, arvoreId: number): Promise<number> {
  return (await db.processoRequerente.updateMany({
    where: { requerenteId, removidoEm: { not: null }, processo: { arvoreId } },
    data: REATIVAR_VINCULO_PROCESSO,
  })).count
}

/** Reativa o vínculo de UM processo (reinserção da pessoa). */
export async function reativarVinculo(db: DB, processoId: number, requerenteId: number): Promise<number> {
  return (await db.processoRequerente.updateMany({
    where: { processoId, requerenteId, removidoEm: { not: null } },
    data: REATIVAR_VINCULO_PROCESSO,
  })).count
}

// ─── A OPERAÇÃO DO MODAL: a lista de requerentes do processo ─────────────────────────────────────────────────────────────────

export interface ResultadoDaLista { adicionados: number[]; retirados: number[]; reativados: number[] }

/**
 * Faz a lista de requerentes ATIVOS do processo ficar igual a `requerenteIds` — por DIFF, em UMA transação:
 *   entra quem faltava (cria ou reativa) · sai quem não está mais (fica com `removidoEm`; a pessoa dele na árvore deixa de ser requerente) ·
 *   quem continua não é tocado. O histórico de quem já saiu nunca é apagado.
 */
export async function atualizarRequerentesDoProcesso(args: { processoId: number; requerenteIds: number[]; autorId?: number | null; db?: Prisma.TransactionClient }): Promise<ResultadoDaLista> {
  const executar = async (tx: Prisma.TransactionClient): Promise<ResultadoDaLista> => {
    const processo = await tx.processo.findUnique({ where: { id: args.processoId }, select: { id: true, arvoreId: true } })
    if (!processo) throw new VinculoRecusado("PROCESSO_NAO_ENCONTRADO", "Processo não encontrado.")
    const pedidos = new Set(args.requerenteIds)
    const ativos = await tx.processoRequerente.findMany({ where: { processoId: processo.id, ...VINCULO_PROCESSO_ATIVO }, select: { requerenteId: true } })
    const ativosIds = new Set(ativos.map((a) => a.requerenteId))
    const sair = [...ativosIds].filter((id) => !pedidos.has(id))
    const entrar = [...pedidos].filter((id) => !ativosIds.has(id))
    const antigos = entrar.length ? await tx.processoRequerente.findMany({ where: { processoId: processo.id, requerenteId: { in: entrar }, removidoEm: { not: null } }, select: { requerenteId: true } }) : []
    const reativados = antigos.map((a) => a.requerenteId)

    for (const requerenteId of sair) {
      await retirarDoProcesso(tx, processo.id, requerenteId, { porId: args.autorId ?? null, motivo: "retirado da lista de requerentes do processo" })
      // A pessoa dele NESTA árvore deixa de ser requerente (o ponteiro `personId` fica: é a identidade, e a reativação o reaproveita).
      const r = await tx.requerente.findUnique({ where: { id: requerenteId }, select: { personId: true } })
      if (r?.personId != null) {
        const p = await tx.pessoa.findUnique({ where: { id: r.personId }, select: { arvoreId: true, requerente: true } })
        if (p && processo.arvoreId != null && p.arvoreId === processo.arvoreId && ehFlagDeRequerente(p.requerente)) await definirFlagDaPessoa(tx, r.personId, "nao")
      }
    }
    if (entrar.length) {
      await incluirNoProcesso(tx, processo.id, entrar)
      // Quem volta já tinha nó nesta árvore: o nó volta a ser requerente.
      for (const requerenteId of entrar) {
        const r = await tx.requerente.findUnique({ where: { id: requerenteId }, select: { personId: true } })
        if (r?.personId == null || processo.arvoreId == null) continue
        const p = await tx.pessoa.findUnique({ where: { id: r.personId }, select: { arvoreId: true, requerente: true, removidaEm: true } })
        if (p && p.arvoreId === processo.arvoreId && p.removidaEm == null && !ehFlagDeRequerente(p.requerente)) await definirFlagDaPessoa(tx, r.personId, "sim", { automatico: true })
      }
    }
    return { adicionados: entrar.filter((id) => !reativados.includes(id)), retirados: sair, reativados }
  }
  return args.db ? executar(args.db) : prisma.$transaction(executar, { timeout: 60_000, maxWait: 20_000 })
}

/** Vínculo na CRIAÇÃO do processo (dentro da transação de quem cria). */
export async function vincularNaCriacaoDoProcesso(tx: Prisma.TransactionClient, processoId: number, requerenteIds: number[]): Promise<void> {
  await incluirNoProcesso(tx, processoId, requerenteIds)
}
