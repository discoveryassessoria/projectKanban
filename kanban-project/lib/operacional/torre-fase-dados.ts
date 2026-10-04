// lib/operacional/torre-fase-dados.ts
// ============================================================================
// LEITURAS EM LOTE DO RADAR E DE PROCESSOS (SERVIDOR) — Torre nova, 01/10/2026.
//
// Tudo aqui lê o banco UMA vez para TODOS os processos (nunca uma consulta por processo — o `take: 300` e o N+1 saíram):
//   • `entradasNaFaseEmLote`  — QUANDO cada processo entrou na fase atual: as MESMAS fontes e a MESMA ordem de precedência de
//                               `entradaNaFase` (metricas-processo.ts): último avanço/movimentação registrado para a fase
//                               (`PhaseAdvanceLog`) → abertura do processo (se a fase é a PRIMEIRA do macrofluxo) → criação do workflow
//                               da fase → nada (`null`: a tela mostra "—"). O teste de integração prova que o lote devolve o MESMO que
//                               `entradaNaFase` processo a processo;
//   • `concluidasDaFaseEmLote` — quantas tarefas da fase atual já foram CONCLUÍDAS com sucesso (cancelada/supersedida NÃO contam);
//   • `fluxoDaSemana`         — quantos processos entraram em cada fase e para onde saíram desde a segunda-feira (log real de fases).
// Sem registro, sem número: nenhuma data é inventada.
// ============================================================================
import { prisma } from '@/lib/prisma'
import type { PrismaClient, Prisma } from '@prisma/client'

type Leitor = PrismaClient | Prisma.TransactionClient
import { RESULTADOS_QUE_MOVEM_DE_FASE, tempoMedioRealPorFase, type EntradaNaFase } from './metricas-processo'
import { metasAtivas, resolverMeta } from './torre-metas'
import { diaOperacional, janelaDoDiaOperacionalDe, inicioDaSemanaOperacional } from './tempo-operacional'

/** As metas de tempo ATIVAS, lidas UMA vez, e a resolução país → padrão → null. A Torre lê as metas por aqui (benchmark de exibição). */
export const metasDaTorre = metasAtivas
export const metaDaFaseDoPais = resolverMeta

export interface ProcessoParaEntrada {
  id: number
  faseAtualKey: string | null
  dataInicio: Date | null
  createdAt: Date
  tipoProcessoMotorId: number | null
}

/** Dias e horas COMPLETOS entre a entrada e `agora` — a mesma conta de `diasNaFaseAtual`. */
export function tempoDesde(desde: string | null, agora: Date): { dias: number | null; horas: number | null } {
  if (!desde) return { dias: null, horas: null }
  const ms = Math.max(0, agora.getTime() - new Date(desde).getTime())
  return { dias: Math.floor(ms / 86_400_000), horas: Math.floor(ms / 3_600_000) }
}

/**
 * QUANDO CADA PROCESSO ENTROU NA FASE EM QUE ESTÁ — em lote (3 consultas, qualquer que seja o nº de processos).
 * `ordensPorTipo` = a ordem das fases de cada macrofluxo (a regra "a fase é a PRIMEIRA do macrofluxo").
 */
export async function entradasNaFaseEmLote(
  procs: ProcessoParaEntrada[], ordensPorTipo: ReadonlyMap<number, ReadonlyMap<string, number>>, db: Leitor = prisma,
): Promise<Map<number, EntradaNaFase>> {
  const saida = new Map<number, EntradaNaFase>()
  const comFase = procs.filter((p): p is ProcessoParaEntrada & { faseAtualKey: string } => p.faseAtualKey != null)
  if (comFase.length === 0) return saida
  const ids = comFase.map((p) => p.id)
  const [avancos, instancias] = await Promise.all([
    db.phaseAdvanceLog.groupBy({
      by: ['processoId', 'fasePretendida'],
      where: { processoId: { in: ids }, resultado: { in: [...RESULTADOS_QUE_MOVEM_DE_FASE] } },
      _max: { criadoEm: true },
    }),
    db.phaseWorkflowInstance.groupBy({
      by: ['processoId', 'faseMacroKey'],
      where: { processoId: { in: ids } },
      _max: { createdAt: true },
    }),
  ])
  const ultimoAvanco = new Map<string, Date>()
  for (const a of avancos) if (a.fasePretendida && a._max.criadoEm) ultimoAvanco.set(`${a.processoId}|${a.fasePretendida}`, a._max.criadoEm)
  const ultimaInstancia = new Map<string, Date>()
  for (const i of instancias) if (i._max.createdAt) ultimaInstancia.set(`${i.processoId}|${i.faseMacroKey}`, i._max.createdAt)

  for (const p of comFase) {
    const fase = p.faseAtualKey
    const avanco = ultimoAvanco.get(`${p.id}|${fase}`)
    if (avanco) { saida.set(p.id, { faseKey: fase, desde: avanco.toISOString(), origem: 'AVANCO_DE_FASE' }); continue }
    const ordens = p.tipoProcessoMotorId != null ? ordensPorTipo.get(p.tipoProcessoMotorId) : undefined
    if (ordens) {
      const ordemDaFase = ordens.get(fase)
      const primeira = ordens.size ? Math.min(...ordens.values()) : null
      if (ordemDaFase != null && primeira != null && ordemDaFase === primeira) {
        saida.set(p.id, { faseKey: fase, desde: (p.dataInicio ?? p.createdAt).toISOString(), origem: 'CADASTRO_DO_PROCESSO' }); continue
      }
    }
    const inst = ultimaInstancia.get(`${p.id}|${fase}`)
    if (inst) { saida.set(p.id, { faseKey: fase, desde: inst.toISOString(), origem: 'INSTANCIA_DA_FASE' }); continue }
    saida.set(p.id, { faseKey: fase, desde: null, origem: null })
  }
  return saida
}

const STATUS_CONCLUIDOS_COM_SUCESSO = ['CONCLUIDO_RECEBIDO', 'CONCLUIDO_NAO_POSSUI'] as const

/** Tarefas CONCLUÍDAS (com sucesso) por processo, na fase em que o processo está agora — uma consulta. */
export async function concluidasDaFaseEmLote(procs: Array<{ id: number; faseAtualKey: string | null }>, db: Leitor = prisma): Promise<Map<number, number>> {
  const fasePorProcesso = new Map(procs.filter((p) => p.faseAtualKey != null).map((p) => [p.id, p.faseAtualKey as string]))
  const saida = new Map<number, number>()
  if (fasePorProcesso.size === 0) return saida
  const grupos = await db.tarefa.groupBy({
    by: ['processoId', 'faseMacroKey'],
    where: { processoId: { in: [...fasePorProcesso.keys()] }, statusTarefa: { in: [...STATUS_CONCLUIDOS_COM_SUCESSO] } },
    _count: { _all: true },
  })
  for (const g of grupos) if (g.processoId != null && g.faseMacroKey === fasePorProcesso.get(g.processoId)) saida.set(g.processoId, (saida.get(g.processoId) ?? 0) + g._count._all)
  return saida
}

// ─── A SEMANA (segunda-feira 00:00 no fuso operacional) ───────────────────────────────────────────────────────────────────

// `inicioDaSemanaOperacional` mora em tempo-operacional.ts (UMA definição de "esta semana" para toda a Torre); reexportada para quem já importava daqui.
export { inicioDaSemanaOperacional }

export interface FluxoDeFase {
  phaseKey: string
  /** Processos que ENTRARAM nesta fase desde segunda-feira. */
  entraram: number
  /** Processos que SAÍRAM desta fase desde segunda-feira, por destino. */
  sairam: Array<{ para: string; n: number }>
}

/**
 * O FLUXO DA SEMANA POR FASE, do log real de transições (`PhaseAdvanceLog`, mesmos resultados que movem de fase), restrito aos
 * processos dados. Um processo conta uma vez por movimento. Cada linha do log: `faseAtual` = de onde saiu, `fasePretendida` = onde entrou.
 */
export async function fluxoDaSemana(processoIds: number[], agora: Date): Promise<FluxoDeFase[]> {
  if (processoIds.length === 0) return []
  const logs = await prisma.phaseAdvanceLog.findMany({
    where: { processoId: { in: processoIds }, resultado: { in: [...RESULTADOS_QUE_MOVEM_DE_FASE] }, criadoEm: { gte: inicioDaSemanaOperacional(agora), lte: agora } },
    select: { faseAtual: true, fasePretendida: true },
  })
  const entraram = new Map<string, number>()
  const sairam = new Map<string, Map<string, number>>()
  for (const l of logs) {
    if (l.fasePretendida) entraram.set(l.fasePretendida, (entraram.get(l.fasePretendida) ?? 0) + 1)
    if (l.faseAtual && l.fasePretendida) {
      const m = sairam.get(l.faseAtual) ?? new Map<string, number>()
      m.set(l.fasePretendida, (m.get(l.fasePretendida) ?? 0) + 1)
      sairam.set(l.faseAtual, m)
    }
  }
  const chaves = new Set([...entraram.keys(), ...sairam.keys()])
  return [...chaves].map((phaseKey) => ({
    phaseKey, entraram: entraram.get(phaseKey) ?? 0,
    sairam: [...(sairam.get(phaseKey) ?? new Map<string, number>())].map(([para, n]) => ({ para, n })).sort((a, b) => b.n - a.n),
  }))
}


// ─── O RESUMO POR FASE (cartão "Saúde da fase") ───────────────────────────────────────────────────────────────────────────────

export interface ResumoDasFases {
  /** Tempo médio real por fase (E11 — o MESMO `tempoMedioRealPorFase` da Visão geral), só de permanências COMPLETAS. */
  tempos: Record<string, { mediaDias: number; amostras: number }>
  /** A meta PADRÃO da fase (sem país) — só exibição; `null` = sem meta cadastrada. */
  metaPadrao: Record<string, number | null>
  /** Entraram/saíram desde segunda-feira, dos processos pedidos. */
  fluxo: Record<string, FluxoDeFase>
}

export async function resumoDasFases(processoIds: number[], faseKeys: string[], agora = new Date()): Promise<ResumoDasFases> {
  const [tempos, metas, fluxo] = await Promise.all([tempoMedioRealPorFase(), metasAtivas(), fluxoDaSemana(processoIds, agora)])
  return {
    tempos: Object.fromEntries(tempos.map((t) => [t.fase, { mediaDias: t.mediaDias, amostras: t.amostras }])),
    metaPadrao: Object.fromEntries(faseKeys.map((k) => [k, resolverMeta(metas, k, null)])),
    fluxo: Object.fromEntries(fluxo.map((f) => [f.phaseKey, f])),
  }
}
