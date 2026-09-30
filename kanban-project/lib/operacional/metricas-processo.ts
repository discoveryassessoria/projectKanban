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

export interface DiasNaFase {
  faseAtual: string | null
  /** Quando entrou — vem de PhaseAdvanceLog (avanço real) OU, na ausência de
   * qualquer avanço registrado, da abertura do processo (cadastro já em
   * andamento). `origem` diz qual dos dois, para nunca fingir precisão que
   * não existe. */
  desde: string | null
  origem: 'AVANCO_DE_FASE' | 'CADASTRO_DO_PROCESSO' | null
  dias: number | null
}

/** E9 · dias na fase — pela data REAL de entrada, no log de transição. */
export async function diasNaFaseAtual(processoId: number, agora = new Date()): Promise<DiasNaFase> {
  const proc = await prisma.processo.findUnique({
    where: { id: processoId }, select: { faseAtualKey: true, dataInicio: true, createdAt: true },
  })
  if (!proc?.faseAtualKey) return { faseAtual: null, desde: null, origem: null, dias: null }

  const ultimoAvanco = await prisma.phaseAdvanceLog.findFirst({
    where: { processoId, resultado: 'MOVIDO', fasePretendida: proc.faseAtualKey },
    orderBy: { criadoEm: 'desc' },
    select: { criadoEm: true },
  })

  const desde = ultimoAvanco?.criadoEm ?? proc.dataInicio ?? proc.createdAt
  const origem: DiasNaFase['origem'] = ultimoAvanco ? 'AVANCO_DE_FASE' : 'CADASTRO_DO_PROCESSO'
  const dias = Math.max(0, Math.floor((agora.getTime() - desde.getTime()) / 86_400_000))
  return { faseAtual: proc.faseAtualKey, desde: desde.toISOString(), origem, dias }
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
    where: { resultado: 'MOVIDO', ...(processoId != null ? { processoId } : {}) },
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
