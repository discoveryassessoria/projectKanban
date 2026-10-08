// src/services/genealogia/propagar-arvore.ts
// ============================================================================
// A ÁRVORE GENEALÓGICA É A ÚNICA FONTE DE VERDADE DOCUMENTAL (CLAUDE.md §37).
//
// Toda necessidade, documento gerado a partir dela, tarefa, passo e contagem
// DERIVAM da árvore. Qualquer mudança nela (casado/solteiro, falecido/vivo,
// pai/mãe, linha reta, requerente, pessoa incluída/removida, regra documental)
// propaga na MESMA transação para tudo o que derivou dela.
//
// ─── A TRANSAÇÃO ÚNICA ──────────────────────────────────────────────────────
// `aplicarMudancaNaArvore(fn)` abre UMA transação interativa (maxWait 20s /
// timeout 60s — o banco de produção custa ~130 ms por ida) e nela executa:
//   1. a mudança da Pessoa/União (`fn`, do chamador);
//   2. o Nº Linhagem da árvore;
//   3. para cada processo da árvore, o reconciliador oficial
//      (`materializarGenealogia(processoId, tx)`), que recalcula as necessidades,
//      dispensa as que saíram (Documento → NAO_EXIGIDO, passos cancelados,
//      tarefa cancelada/marcada), reativa/cria as que entraram (Documento +
//      passo local) e converge as tarefas (`reconciliarTarefas({db: tx})`);
//   4. UMA linha de LogAuditoria por fato, legível.
// Falhou QUALQUER parte → rollback de tudo, e o erro SOBE (a rota devolve HTTP
// de erro; nada é engolido).
//
// ─── O QUE FICA FORA DA TRANSAÇÃO (e por quê) ───────────────────────────────
// `materializarExecucaoDaFase` (workflow PUBLICADO da fase atual → passos/tarefas
// das necessidades que NASCERAM), o motor financeiro de honorários e o avanço
// automático de fase usam o client global e abrem transações próprias — não
// aceitam `tx`. Rodam DEPOIS do commit, são idempotentes e, se falharem, o erro
// também sobe (`PropagacaoPosCommitError`, com `salvo: true`): a mudança da árvore
// e o cancelamento do que saiu JÁ estão gravados; só a criação do trabalho novo
// precisa ser repetida (repetir é seguro). Nada que SAI da árvore depende dessa
// parte: remoção/cancelamento é 100% atômico.
// ============================================================================

import { prisma } from "@/lib/prisma"
import type { Prisma } from "@prisma/client"
import {
  materializarGenealogia,
  type MaterializarResultado,
  type FatoNecessidade,
} from "@/src/services/genealogia/materializar-genealogia"
import { descreverMudancaDocumentosExigidos } from "@/src/lib/genealogia/documentos-exigidos"
import { recalcularNumerosLinhagemDaArvore } from "@/src/services/genealogia/numero-linhagem"
import { materializarExecucaoDaFase } from "@/src/services/materializar-fase"
import { reconciliarMotorDeFases } from "@/src/lib/motor/reconciliar-motor-fases"
import { aplicarHonorariosCidadaniaItaliana } from "@/src/lib/motor/executor"

// `TIMEOUT_TX_ARVORE_MS` só existe para operação em LOTE rodada da máquina de quem opera (a latência até o banco é bem maior que a da Vercel); em produção fica o padrão.
export const OPCOES_TX_ARVORE = { maxWait: 20_000, timeout: Number(process.env.TIMEOUT_TX_ARVORE_MS) > 0 ? Number(process.env.TIMEOUT_TX_ARVORE_MS) : 60_000 } as const

export interface AutorDaMudanca { id: number | null; nome: string | null }

export interface ResultadoPropagacao {
  arvoreId: number
  processos: Array<{ processoId: number; resultado: MaterializarResultado }>
  fatos: FatoNecessidade[]
  preservadasSemCausa: MaterializarResultado["preservadasSemCausa"]
}

/** Falha DEPOIS do commit: a árvore e o que saiu dela estão gravados; repetir é seguro. */
export class PropagacaoPosCommitError extends Error {
  readonly salvo = true as const
  constructor(readonly causas: string[]) {
    super(`A alteração foi salva, mas a convergência do trabalho novo falhou (${causas.join(" ; ")}). Repita a operação — é idempotente.`)
    this.name = "PropagacaoPosCommitError"
  }
}

/** Nome legível do autor, para a auditoria ("alterado por Marco Rovatti"). */
export async function autorLegivel(db: Prisma.TransactionClient | typeof prisma, usuarioId: number | null | undefined): Promise<AutorDaMudanca> {
  if (!usuarioId) return { id: null, nome: null }
  const u = await db.usuario.findUnique({ where: { id: usuarioId }, select: { nome: true } })
  return { id: usuarioId, nome: u?.nome ?? null }
}

interface PessoaComparavel {
  casado?: boolean | null; vivo?: boolean | null; paiId?: number | null; maeId?: number | null
  linhaReta?: boolean | null; requerente?: string | null; documentacao?: boolean | null
  documentosExigidos?: unknown
}

const EH_REQ = (v: string | null | undefined) => ["sim", "maior", "menor"].includes(String(v ?? "").toLowerCase())

/** O QUE MUDOU na Pessoa, em palavras. Vazio = nada que a árvore documental leia. */
export function descreverMudancaPessoa(antes: PessoaComparavel | null, depois: PessoaComparavel): string[] {
  const m: string[] = []
  if (!antes) return m
  if (antes.casado !== depois.casado) m.push(depois.casado ? "pessoa passou a ser casada" : "pessoa deixou de ser casada")
  if (antes.vivo !== depois.vivo) m.push(depois.vivo === false ? "pessoa marcada como falecida" : "pessoa voltou a constar como viva")
  if ((antes.paiId ?? null) !== (depois.paiId ?? null)) m.push("pai da pessoa alterado")
  if ((antes.maeId ?? null) !== (depois.maeId ?? null)) m.push("mãe da pessoa alterada")
  if (antes.linhaReta !== depois.linhaReta) m.push(depois.linhaReta ? "pessoa entrou na linha reta" : "pessoa saiu da linha reta")
  if (EH_REQ(antes.requerente) !== EH_REQ(depois.requerente)) m.push(EH_REQ(depois.requerente) ? "pessoa passou a ser requerente" : "pessoa deixou de ser requerente")
  if (antes.documentacao !== depois.documentacao) m.push(depois.documentacao ? "pessoa passou a precisar de documentação" : "pessoa deixou de precisar de documentação")
  const docs = descreverMudancaDocumentosExigidos(antes.documentosExigidos, depois.documentosExigidos)
  if (docs) m.push(docs)
  return m
}

/** Campos da Pessoa que a árvore documental lê (select reutilizável "antes/depois"). */
export const SELECT_PESSOA_COMPARAVEL = {
  casado: true, vivo: true, paiId: true, maeId: true, linhaReta: true, requerente: true, documentacao: true, documentosExigidos: true, arvoreId: true,
} as const

/**
 * NÚCLEO — a propagação DENTRO de uma transação já aberta (do chamador). Nunca
 * captura erro: qualquer falha sobe e desfaz a transação inteira.
 */
export async function propagarNaTransacao(
  tx: Prisma.TransactionClient,
  args: { arvoreId: number | null | undefined; motivo: string; autor?: AutorDaMudanca | null },
): Promise<ResultadoPropagacao | null> {
  if (!args.arvoreId) return null
  await recalcularNumerosLinhagemDaArvore(args.arvoreId, tx)
  const procs = await tx.processo.findMany({ where: { arvoreId: args.arvoreId }, select: { id: true }, orderBy: { id: "asc" } })
  const out: ResultadoPropagacao = { arvoreId: args.arvoreId, processos: [], fatos: [], preservadasSemCausa: [] }
  for (const p of procs) {
    const resultado = await materializarGenealogia(p.id, tx, { motivo: args.motivo, autor: args.autor ?? null })
    out.processos.push({ processoId: p.id, resultado })
    out.fatos.push(...resultado.fatos)
    out.preservadasSemCausa.push(...resultado.preservadasSemCausa)
  }
  return out
}

/**
 * Efeitos que NÃO aceitam `tx` (ver cabeçalho). Depois do commit; idempotentes;
 * erro SOBE como `PropagacaoPosCommitError`.
 */
export async function efeitosPosCommitDaArvore(arvoreId: number | null | undefined): Promise<void> {
  if (!arvoreId) return
  const causas: string[] = []
  const procs = await prisma.processo.findMany({ where: { arvoreId }, select: { id: true } })
  for (const p of procs) {
    try { await materializarExecucaoDaFase({ processoId: p.id, fonte: "RECONCILIACAO" }) }
    catch (e) { causas.push(`fase do processo ${p.id}: ${e instanceof Error ? e.message : String(e)}`) }
    try { await aplicarHonorariosCidadaniaItaliana(p.id) }
    catch (e) { causas.push(`honorários do processo ${p.id}: ${e instanceof Error ? e.message : String(e)}`) }
    try { await reconciliarMotorDeFases(p.id, { origem: "cron-reconciliacao" }) }
    catch (e) { causas.push(`avanço de fase do processo ${p.id}: ${e instanceof Error ? e.message : String(e)}`) }
  }
  if (causas.length) {
    console.error("[árvore → efeitos pós-commit]", causas.join(" ; "))
    throw new PropagacaoPosCommitError(causas)
  }
}

/**
 * A PORTA. Mudança da árvore (`fn`, dentro da transação) + propagação + auditoria,
 * atomicamente; depois os efeitos pós-commit. `motivo` é chamado com o resultado
 * de `fn` (o "antes/depois" só existe lá dentro) e devolve o que mudou em palavras;
 * string vazia = nada que a árvore documental leia (pula a propagação).
 */
export async function aplicarMudancaNaArvore<T>(args: {
  arvoreId: number | null | undefined
  autorId?: number | null
  fn: (tx: Prisma.TransactionClient) => Promise<T>
  motivo: (resultado: T) => string
  /** Árvore pode ser conhecida só depois de `fn` (ex.: pessoa criada). */
  arvoreIdDe?: (resultado: T) => number | null | undefined
}): Promise<{ resultado: T; propagacao: ResultadoPropagacao | null }> {
  const { resultado, propagacao, arvoreId } = await prisma.$transaction(async (tx) => {
    const r = await args.fn(tx)
    const motivo = args.motivo(r)
    const arvoreId = args.arvoreIdDe?.(r) ?? args.arvoreId
    if (!motivo || !arvoreId) return { resultado: r, propagacao: null, arvoreId: null as number | null }
    const autor = await autorLegivel(tx, args.autorId)
    const propagacao = await propagarNaTransacao(tx, { arvoreId, motivo, autor })
    return { resultado: r, propagacao, arvoreId }
  }, OPCOES_TX_ARVORE)
  if (arvoreId) await efeitosPosCommitDaArvore(arvoreId)
  return { resultado, propagacao }
}

/**
 * Propagação avulsa (sem mudança própria): para quem já gravou tudo e só precisa
 * convergir — ex.: regra documental publicada/inativada. Mesma transação única.
 */
export async function propagarArvoreAgora(args: { arvoreId: number | null | undefined; motivo: string; autorId?: number | null }): Promise<ResultadoPropagacao | null> {
  if (!args.arvoreId) return null
  const r = await prisma.$transaction(async (tx) => {
    const autor = await autorLegivel(tx, args.autorId)
    return propagarNaTransacao(tx, { arvoreId: args.arvoreId, motivo: args.motivo, autor })
  }, OPCOES_TX_ARVORE)
  await efeitosPosCommitDaArvore(args.arvoreId)
  return r
}

// ============================================================================
// REGRA DOCUMENTAL MUDOU (publicar / inativar / arquivar / reativar / editar).
//
// A regra é a outra metade da fonte de verdade: a árvore diz QUEM é, a regra diz O
// QUE se exige de quem é. Mudar a regra tem que reconciliar os processos ABERTOS
// que dependem dela — e SÓ esses (sem varredura em massa de dado alheio):
//   • processos com necessidade gravada por qualquer versão desta regra (mesmo `codigo`); e
//   • processos abertos aos quais a regra se aplica e que a exigem na Genealogia
//     (publicar uma regra nova faz nascer a exigência onde ela vale).
// Idempotente: reconciliar de novo não muda nada. Uma transação POR ÁRVORE (os
// processos de uma árvore dividem as mesmas pessoas); a mudança da regra em si já
// foi gravada pela rota — se a propagação falhar o erro sobe (`salvo: true`) e a
// mesma ação pode ser repetida com segurança.
// ============================================================================
import { matrizParaRegra } from "@/src/lib/documentos/regras-documentais/mapear"
import { aplicaAoProcesso, exigidaNaGenealogia } from "@/src/services/genealogia/materializar-genealogia"

export async function processosAfetadosPelaRegra(regraId: number): Promise<{ processoIds: number[]; arvoreIds: number[] }> {
  const row = await prisma.matrizDocumental.findUnique({ where: { id: regraId } })
  if (!row) return { processoIds: [], arvoreIds: [] }
  const versoes = row.codigo ? await prisma.matrizDocumental.findMany({ where: { codigo: row.codigo }, select: { id: true } }) : [{ id: row.id }]
  const ids = versoes.map((v) => v.id)
  const comNecessidade = await prisma.necessidadeDocumental.findMany({
    where: { matrizRegraId: { in: ids } }, select: { processoId: true }, distinct: ["processoId"],
  })
  const conjunto = new Set(comNecessidade.map((n) => n.processoId))
  const regra = matrizParaRegra(row)
  if (exigidaNaGenealogia(regra)) {
    const abertos = await prisma.processo.findMany({
      where: { dataConclusao: null, arvoreId: { not: null }, tipoProcessoMotorId: { not: null } },
      select: { id: true, tipoProcessoMotorId: true },
    })
    for (const p of abertos) if (aplicaAoProcesso(regra, p.tipoProcessoMotorId)) conjunto.add(p.id)
  }
  if (conjunto.size === 0) return { processoIds: [], arvoreIds: [] }
  const procs = await prisma.processo.findMany({
    where: { id: { in: [...conjunto] }, dataConclusao: null, arvoreId: { not: null } },
    select: { id: true, arvoreId: true },
  })
  return { processoIds: procs.map((p) => p.id), arvoreIds: [...new Set(procs.map((p) => p.arvoreId as number))] }
}

export async function propagarMudancaDeRegra(args: { regraId: number; motivo: string; autorId?: number | null }): Promise<{ arvoreIds: number[]; fatos: FatoNecessidade[] }> {
  const { arvoreIds } = await processosAfetadosPelaRegra(args.regraId)
  const fatos: FatoNecessidade[] = []
  for (const arvoreId of arvoreIds) {
    const r = await propagarArvoreAgora({ arvoreId, motivo: args.motivo, autorId: args.autorId })
    if (r) fatos.push(...r.fatos)
  }
  return { arvoreIds, fatos }
}
