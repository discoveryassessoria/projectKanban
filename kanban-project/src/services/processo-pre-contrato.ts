// src/services/processo-pre-contrato.ts
// ============================================================================
// PROCESSO "AGUARDANDO FECHAMENTO" (fase `a_iniciar`) FORA DA TORRE — o ponto canônico, irmão do da PAUSA.
//
// A Torre mede TRABALHO. Um processo em "Aguardando fechamento" ainda não é trabalho: não tem certidão, tarefa nem número. Por isso ele
// fica FORA de todos os totais e listas da Torre (Tarefas abertas, Sem responsável, Aguardando terceiros, Atrasadas, "Precisa de você"
// [os 6 tipos, inclusive "Fase deixada"], backlog/tendências/foto diária, Radar, Processos, Equipe, Terceiros) — e VOLTA aos números de
// antes assim que é movido para Genealogia. O filtro é UM só e NASCE COMBINADO com o da pausa (`processo-pausa.ts`), nos MESMOS pontos:
//
//   • em MEMÓRIA (linhas já lidas):   `idsDeProcessosForaDaTorre` + `semProcessosForaDaTorre`  (pausados ∪ aguardando fechamento)
//   • no BANCO (consulta a Processo): `ONDE_PROCESSO_ATIVO_E_NA_TORRE` / `ONDE_PROCESSO_NA_TORRE`
//   • no BANCO (consulta a Tarefa):   `ONDE_TAREFA_DE_PROCESSO_NA_TORRE`
//
// O que NÃO muda: a Operação/Central/sino/Home (as tarefas continuam com quem as tem — como já é para processo pausado), o Foco/Detalhe
// do processo e a distribuição (`incluirPausados: true` abre o processo mesmo fora da Torre).
// ============================================================================
import type { Prisma, PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { PHASEKEY_A_INICIAR } from '@/src/lib/process-stage/fase-pre-contrato'
import { idsDeProcessosPausados, ONDE_PROCESSO_NAO_PAUSADO } from '@/src/services/processo-pausa'

type Leitor = PrismaClient | Prisma.TransactionClient

/** Os ids dos processos que estão em "Aguardando fechamento" — UMA consulta, constante no volume. */
export async function idsDeProcessosAguardandoFechamento(db: Leitor = prisma): Promise<Set<number>> {
  const ps = await db.processo.findMany({ where: { faseAtualKey: PHASEKEY_A_INICIAR }, select: { id: true } })
  return new Set(ps.map((p) => p.id))
}

/**
 * A MESMA condição como filtro de banco para `Processo`: "NÃO está em Aguardando fechamento". `faseAtualKey` NULL conta como fora
 * dessa fase (um `not`/`notIn` simples excluiria os nulos em SQL — por isso o `OR` explícito).
 */
export const ONDE_PROCESSO_FORA_DO_AGUARDANDO_FECHAMENTO: Prisma.ProcessoWhereInput = {
  OR: [{ faseAtualKey: null }, { faseAtualKey: { not: PHASEKEY_A_INICIAR } }],
}

/**
 * "PROCESSO NA TORRE" = não pausado E não em Aguardando fechamento. Vem embrulhado em `AND` (nunca em spread plano): quem consome
 * costuma acrescentar `faseAtualKey: {...}` ou `OR: [...]` na mesma cláusula, e uma chave repetida SOBRESCREVERIA este filtro em
 * silêncio (foi o risco de `precisa-de-voce.ts`, onde o `where` espalhava a constante e depois definia `faseAtualKey`).
 */
export const ONDE_PROCESSO_NA_TORRE: Prisma.ProcessoWhereInput = {
  AND: [ONDE_PROCESSO_NAO_PAUSADO, ONDE_PROCESSO_FORA_DO_AGUARDANDO_FECHAMENTO],
}

/** "Processo ativo" em QUALQUER tela: não concluído E na Torre (não pausado, fora de Aguardando fechamento). Uma definição só. */
export const ONDE_PROCESSO_ATIVO_E_NA_TORRE: Prisma.ProcessoWhereInput = { AND: [{ dataConclusao: null }, ONDE_PROCESSO_NA_TORRE] }

/** Para consultas a `Tarefa`: a tarefa AVULSA (sem processo) entra; a de processo só se o processo está na Torre. */
export const ONDE_TAREFA_DE_PROCESSO_NA_TORRE: Prisma.TarefaWhereInput = {
  OR: [{ processoId: null }, { processo: ONDE_PROCESSO_NA_TORRE }],
}

/**
 * Quantos processos estão em "Aguardando fechamento" (ativos, não concluídos, não pausados) — o contador da linha PRÓPRIA do funil
 * da Visão geral, FORA do total e da barra de risco. `paisLabel` recorta pelo país do processo (`CatalogoPais.countryLabel`).
 */
export async function contarProcessosAguardandoFechamento(opts: { paisLabel?: string | null; db?: Leitor } = {}): Promise<number> {
  const db = opts.db ?? prisma
  return db.processo.count({
    where: {
      AND: [
        { faseAtualKey: PHASEKEY_A_INICIAR, dataConclusao: null }, ONDE_PROCESSO_NAO_PAUSADO,
        ...(opts.paisLabel ? [{ paisCanonico: { countryLabel: opts.paisLabel } }] : []),
      ],
    },
  })
}

/** Os ids dos processos FORA da Torre por esta fase ∪ pausa — o conjunto que `semProcessosForaDaTorre` consome. UMA ida ao banco por origem. */
export async function idsDeProcessosForaDaTorre(db: Leitor = prisma): Promise<Set<number>> {
  const [pausados, aguardando] = await Promise.all([idsDeProcessosPausados(db), idsDeProcessosAguardandoFechamento(db)])
  if (aguardando.size === 0) return pausados
  if (pausados.size === 0) return aguardando
  return new Set([...pausados, ...aguardando])
}

/** Tira as linhas de processos fora da Torre. Linha sem processo (tarefa avulsa) nunca sai. PURA: o conjunto vem de fora. */
export function semProcessosForaDaTorre<T extends { processoId: number | null }>(linhas: T[], fora: ReadonlySet<number>): T[] {
  return fora.size === 0 ? linhas : linhas.filter((l) => l.processoId == null || !fora.has(l.processoId))
}
