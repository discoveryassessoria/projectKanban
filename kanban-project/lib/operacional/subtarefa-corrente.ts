// lib/operacional/subtarefa-corrente.ts
// ============================================================================
// A SUBTAREFA CORRENTE DE UM PASSO E O ACOMPANHAMENTO VENCIDO — REGRA ÚNICA.
//
// ACHADO REAL (30/09/2026, processo 651, #3864/#3866/#3868/#3869/#3870/#3871):
// o rótulo da tela ("Atrasada há 2 dias", `acompanhamentoPasso`) e o sinal
// `acompanhamentoVencido` (Torre: visão, KPI "Cobranças vencidas", Operação,
// avisos) eram calculados em DOIS lugares que escolhiam a subtarefa
// diferente:
//   • `progressoPorSubtarefa` (tarefa-projecoes.ts): a CORRENTE = primeira
//     alcançável não encerrada, em QUALQUER status (inclusive DISPONIVEL,
//     "a iniciar");
//   • `estadosTemporaisDasOperacoes` (proximo-acontecimento.ts): só a
//     subtarefa em `AGUARDANDO_EXTERNO`.
// Uma subtarefa "a iniciar" com `proximoAcompanhamentoEm` no passado mostrava
// o rótulo vermelho e NÃO entrava em "Acompanhamentos vencidos".
//
// Este módulo é PURO (exceto `definicoesDasSubtarefas`, que só recebe o leitor
// por parâmetro): as duas leituras importam DAQUI.
// ============================================================================
import type { Prisma, PrismaClient } from '@prisma/client'
import { diasEntreDiasOperacionais } from './tempo-operacional'
import { lerVersaoPublicada } from '@/src/services/versao-publicada'

type Leitor = PrismaClient | Prisma.TransactionClient

/** Estados de `SubtaskExecution` em que a subtarefa já não é "corrente". */
export const SUBTAREFA_ENCERRADA_STATUS: ReadonlySet<string> = new Set(['CONCLUIDO', 'CANCELADO', 'INVALIDADO', 'FALHOU'])

export interface DefinicaoDeSubtarefa { label: string; dependeDe: string[] }

/**
 * A CORRENTE é a alcançável de menor ordem — NUNCA só "menor ordem entre as
 * não-encerradas" (hotfix Cibils 26/09/2026): uma subtarefa cuja dependência
 * ainda não concluiu jamais é "atual". `dependeDe` é a fonte de
 * alcançabilidade; `ordem` é só desempate/display.
 */
export function escolherSubtarefaCorrente<E extends { subtaskKey: string; status: string }>(
  execs: E[],
  defs: Map<string, { dependeDe: string[] }> | undefined,
  ordens: Map<string, number> | undefined,
): E | null {
  const concluidasKeys = new Set(execs.filter((e) => e.status === 'CONCLUIDO').map((e) => e.subtaskKey))
  return execs
    .filter((e) => !SUBTAREFA_ENCERRADA_STATUS.has(e.status))
    .filter((e) => (defs?.get(e.subtaskKey)?.dependeDe ?? []).every((dep) => concluidasKeys.has(dep)))
    .sort((a, b) => (ordens?.get(a.subtaskKey) ?? 0) - (ordens?.get(b.subtaskKey) ?? 0))[0] ?? null
}

/**
 * ACOMPANHAMENTO VENCIDO — a regra ÚNICA, POR DIA no fuso operacional: a data
 * de acompanhamento é hoje ou já passou. É exatamente
 * `atrasado || venceHoje` do rótulo (`estadoTemporalSubtarefa` →
 * `nucleoTemporal`: dias < 0 = "Atrasada há N dias", dias === 0 = "Vence
 * hoje") — a mesma matemática (`diasEntreDiasOperacionais`), então o rótulo e
 * o sinal nunca divergem. Sem data ⇒ nunca vencido.
 */
export function acompanhamentoVenceuNoDia(data: Date | string | null | undefined, agora: Date): boolean {
  if (data == null) return false
  const d = data instanceof Date ? data : new Date(data)
  if (Number.isNaN(d.getTime())) return false
  return diasEntreDiasOperacionais(d, agora) <= 0
}

/**
 * `ordem`/`dependeDe`/rótulo de cada subtarefa ATIVA do passo, pela definição
 * CONGELADA da versão que a instância registrou (`lerVersaoPublicada`) — nunca
 * a definição viva. Em lote: uma consulta para as instâncias, uma por par
 * (definição, versão) distinto.
 */
export async function definicoesDasSubtarefas(
  db: Leitor,
  passos: Array<{ stepInstanceId: number; stepKey: string; workflowInstanceId: number | null }>,
): Promise<Map<number, { ordens: Map<string, number>; defs: Map<string, DefinicaoDeSubtarefa> }>> {
  const saida = new Map<number, { ordens: Map<string, number>; defs: Map<string, DefinicaoDeSubtarefa> }>()
  const instanciaIds = [...new Set(passos.map((p) => p.workflowInstanceId).filter((x): x is number => x != null))]
  if (instanciaIds.length === 0) return saida
  const instancias = await db.phaseWorkflowInstance.findMany({
    where: { id: { in: instanciaIds } },
    select: { id: true, workflowDefinitionId: true, workflowVersion: true },
  })
  const instanciaPorId = new Map(instancias.map((i) => [i.id, i]))
  const pares = new Map<string, { workflowDefinitionId: number; workflowVersion: number }>()
  for (const i of instancias) {
    if (i.workflowDefinitionId == null || i.workflowVersion == null) continue
    pares.set(`${i.workflowDefinitionId}:${i.workflowVersion}`, { workflowDefinitionId: i.workflowDefinitionId, workflowVersion: i.workflowVersion })
  }
  const versoes = new Map(await Promise.all(
    [...pares.entries()].map(async ([chave, p]) => [chave, await lerVersaoPublicada(p.workflowDefinitionId, p.workflowVersion, db)] as const),
  ))
  for (const p of passos) {
    if (p.workflowInstanceId == null) continue
    const inst = instanciaPorId.get(p.workflowInstanceId)
    if (!inst?.workflowDefinitionId || inst.workflowVersion == null) continue
    const passo = versoes.get(`${inst.workflowDefinitionId}:${inst.workflowVersion}`)?.passos.find((x) => x.key === p.stepKey)
    const ativas = passo?.subtarefas?.filter((s) => s.ativo !== false) ?? []
    if (ativas.length === 0) continue
    saida.set(p.stepInstanceId, {
      ordens: new Map(ativas.map((s) => [s.key, s.ordem])),
      defs: new Map(ativas.map((s) => [s.key, { label: s.label, dependeDe: s.dependeDe ?? [] }])),
    })
  }
  return saida
}
