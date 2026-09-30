// lib/operacional/metricas-processo.ts
// ============================================================================
// MÉTRICAS DE PROCESSO — Torre de Controle, Bloco E9 e E11 (29/09/2026).
//
// UMA FONTE POR DADO (Regra 5 do mandato): progresso real vem de
// `resolverCompletudeDocumental` (a mesma fonte que a Central usa para
// completude documental — nada recalculado aqui). Dias na fase e tempo médio
// por fase vêm de `PhaseAdvanceLog`, o log real de transição — nunca uma
// conta própria sobre `Tarefa.createdAt`.
// ============================================================================
import { prisma } from '@/lib/prisma'
import { resolverCompletudeDocumental } from '@/src/lib/process-stage/completude-documental'
import { STATUS_ATIVOS } from './tarefa-canonica'
import { ordensDeFase } from '@/src/services/documento-operacao'

export interface ProgressoReal {
  required: number
  completed: number
  percentage: number
}

/** E9 · progresso real = certidões recebidas ÷ requeridas, na fase ATIVA. */
export async function progressoRealDoProcesso(processoId: number): Promise<ProgressoReal> {
  const c = await resolverCompletudeDocumental(processoId)
  return { required: c.required, completed: c.completed, percentage: c.percentage }
}

/**
 * OS RESULTADOS DO LOG QUE SIGNIFICAM "O PROCESSO CHEGOU EM `fasePretendida`": movimentação manual (MOVIDO), avanço pelo
 * gate (AVANCADO) e avanço forçado (FORCADO). BLOQUEADO/IDEMPOTENTE/CONFLITO não moveram nada. (RETORNADO/REABERTO
 * ainda não existem no log de produção e a semântica do destino deles não está provada — ficam de fora até existirem.)
 * A MESMA constante serve a "Dias na fase" e ao "Tempo médio real por fase": uma fonte para "quando entrou".
 */
export const RESULTADOS_QUE_MOVEM_DE_FASE = ['MOVIDO', 'AVANCADO', 'FORCADO'] as const

export interface DiasNaFase {
  faseAtual: string | null
  /** Quando entrou na fase ATUAL — só de registro REAL (nunca "agora"). `null` = não há registro: a tela mostra "—". */
  desde: string | null
  /**
   * De onde veio `desde`:
   *   AVANCO_DE_FASE       o último avanço/movimentação registrado para esta fase (PhaseAdvanceLog);
   *   CADASTRO_DO_PROCESSO a abertura do processo — VÁLIDA só quando a fase atual é a PRIMEIRA do macrofluxo (entrou nela ao nascer);
   *   INSTANCIA_DA_FASE    a criação do workflow da fase (PhaseWorkflowInstance) — último recurso registrado.
   */
  origem: 'AVANCO_DE_FASE' | 'CADASTRO_DO_PROCESSO' | 'INSTANCIA_DA_FASE' | null
  /** Dias COMPLETOS (0 = menos de 24 h). `null` quando não há data. */
  dias: number | null
  /** Horas completas desde a entrada — para "há 5 h" quando ainda não fechou 1 dia. `null` quando não há data. */
  horas: number | null
}

/**
 * E9 · dias na fase — pela data REAL de entrada. Ordem das fontes, da mais precisa para a menos (nenhuma inventa data):
 *   1. o último avanço/movimentação registrado PARA a fase atual (`PhaseAdvanceLog`, `RESULTADOS_QUE_MOVEM_DE_FASE`);
 *   2. se a fase atual é a PRIMEIRA do macrofluxo do tipo, a abertura do processo (ele nasceu nela);
 *   3. a criação do workflow daquela fase (`PhaseWorkflowInstance`);
 *   4. nada disso existe → `desde: null` (a tela mostra "—"). Jamais o relógio de agora.
 */
export async function diasNaFaseAtual(processoId: number, agora = new Date()): Promise<DiasNaFase> {
  const proc = await prisma.processo.findUnique({
    where: { id: processoId }, select: { faseAtualKey: true, dataInicio: true, createdAt: true, tipoProcessoMotorId: true },
  })
  if (!proc?.faseAtualKey) return { faseAtual: null, desde: null, origem: null, dias: null, horas: null }
  const fase = proc.faseAtualKey
  const monta = (desde: Date, origem: NonNullable<DiasNaFase['origem']>): DiasNaFase => {
    const ms = Math.max(0, agora.getTime() - desde.getTime())
    return { faseAtual: fase, desde: desde.toISOString(), origem, dias: Math.floor(ms / 86_400_000), horas: Math.floor(ms / 3_600_000) }
  }

  const ultimoAvanco = await prisma.phaseAdvanceLog.findFirst({
    where: { processoId, resultado: { in: [...RESULTADOS_QUE_MOVEM_DE_FASE] }, fasePretendida: fase },
    orderBy: { criadoEm: 'desc' }, select: { criadoEm: true },
  })
  if (ultimoAvanco) return monta(ultimoAvanco.criadoEm, 'AVANCO_DE_FASE')

  if (proc.tipoProcessoMotorId != null) {
    const ordens = await ordensDeFase(proc.tipoProcessoMotorId)
    const ordemAtual = ordens.get(fase)
    const primeira = ordens.size ? Math.min(...ordens.values()) : null
    if (ordemAtual != null && primeira != null && ordemAtual === primeira) return monta(proc.dataInicio ?? proc.createdAt, 'CADASTRO_DO_PROCESSO')
  }

  const instancia = await prisma.phaseWorkflowInstance.findFirst({
    where: { processoId, faseMacroKey: fase }, orderBy: { createdAt: 'desc' }, select: { createdAt: true },
  })
  if (instancia) return monta(instancia.createdAt, 'INSTANCIA_DA_FASE')

  return { faseAtual: fase, desde: null, origem: null, dias: null, horas: null }
}

/**
 * E9 · PRÓXIMO MARCO — texto derivado do estado real das tarefas ativas na
 * fase atual, no formato do protótipo ("N pedidos ao cartório; X enviados, Y
 * a enviar"). `null` quando não há nenhuma tarefa ativa na fase (nada a
 * reportar — nunca um texto fixo).
 */
export async function proximoMarco(processoId: number): Promise<string | null> {
  const proc = await prisma.processo.findUnique({ where: { id: processoId }, select: { faseAtualKey: true } })
  if (!proc?.faseAtualKey) return null

  const tarefas = await prisma.tarefa.findMany({
    where: { processoId, faseMacroKey: proc.faseAtualKey, statusTarefa: { in: STATUS_ATIVOS } },
    select: { statusTarefa: true },
  })
  if (tarefas.length === 0) return null

  const enviados = tarefas.filter((t) => t.statusTarefa === 'AGUARDANDO_TERCEIRO').length
  const aEnviar = tarefas.length - enviados
  return `${tarefas.length} pedido(s) na fase; ${enviados} enviado(s), ${aEnviar} a enviar`
}

export interface MetricasDeProcesso {
  progresso: ProgressoReal
  diasNaFase: DiasNaFase
  proximoMarco: string | null
}

export async function metricasDoProcesso(processoId: number): Promise<MetricasDeProcesso> {
  const [progresso, diasNaFase, marco] = await Promise.all([
    progressoRealDoProcesso(processoId),
    diasNaFaseAtual(processoId),
    proximoMarco(processoId),
  ])
  return { progresso, diasNaFase, proximoMarco: marco }
}

// ─── E11 · TEMPO MÉDIO REAL POR FASE ────────────────────────────────────────

export interface TempoPorFase {
  fase: string
  amostras: number
  mediaDias: number
}

/**
 * O TEMPO MÉDIO REAL POR FASE, a partir do log de transição.
 *
 * Cada permanência numa fase é o intervalo entre DUAS linhas MOVIDO
 * consecutivas do MESMO processo: a que entrou nela (`fasePretendida =
 * fase`) e a próxima que saiu dela (`faseAtual = fase`, cronologicamente
 * depois). Uma fase ainda em curso (sem saída registrada) não entra na
 * média — só permanências COMPLETAS, para não subestimar o tempo real.
 *
 * `processoId` ausente = geral (todos os processos, mesma régua).
 */
export async function tempoMedioRealPorFase(processoId?: number): Promise<TempoPorFase[]> {
  const logs = await prisma.phaseAdvanceLog.findMany({
    where: { resultado: { in: [...RESULTADOS_QUE_MOVEM_DE_FASE] }, ...(processoId != null ? { processoId } : {}) },
    orderBy: [{ processoId: 'asc' }, { criadoEm: 'asc' }],
    select: { processoId: true, faseAtual: true, fasePretendida: true, criadoEm: true },
  })

  // Agrupa por processo, para casar ENTRADA→SAÍDA só dentro do mesmo processo.
  const porProcesso = new Map<number, typeof logs>()
  for (const l of logs) {
    const lista = porProcesso.get(l.processoId) ?? []
    lista.push(l)
    porProcesso.set(l.processoId, lista)
  }

  const somaPorFase = new Map<string, { somaDias: number; amostras: number }>()
  for (const lista of porProcesso.values()) {
    for (const entrada of lista) {
      if (!entrada.fasePretendida) continue
      const saida = lista.find((l) => l.criadoEm > entrada.criadoEm && l.faseAtual === entrada.fasePretendida)
      if (!saida) continue // ainda em curso — não entra na média
      const dias = (saida.criadoEm.getTime() - entrada.criadoEm.getTime()) / 86_400_000
      const atual = somaPorFase.get(entrada.fasePretendida) ?? { somaDias: 0, amostras: 0 }
      somaPorFase.set(entrada.fasePretendida, { somaDias: atual.somaDias + dias, amostras: atual.amostras + 1 })
    }
  }

  return [...somaPorFase.entries()]
    .map(([fase, v]) => ({ fase, amostras: v.amostras, mediaDias: Math.round((v.somaDias / v.amostras) * 10) / 10 }))
    .sort((a, b) => b.mediaDias - a.mediaDias)
}
