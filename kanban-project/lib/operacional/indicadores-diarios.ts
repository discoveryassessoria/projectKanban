// lib/operacional/indicadores-diarios.ts
// ============================================================================
// SÉRIE DIÁRIA DOS INDICADORES DA TORRE — Bloco E10 (29/09/2026).
//
// UMA FONTE POR DADO (Regra 5 do mandato): os 7 KPIs de tarefa vêm de `kpisDasLinhas`
// (`torre-kpis.ts`) sobre as MESMAS linhas da aba Tarefas (Bloco J3, 30/09/2026 — antes usavam
// `indicadoresGerenciais`, com definições ligeiramente diferentes da lista que o cartão filtra).
//
//   venc      → indicadoresGerenciais.atrasadas
//   v7        → visaoGerencial({ proximos7Dias: true }).total
//   semdono   → indicadoresGerenciais.semResponsavel
//   aguard    → indicadoresGerenciais.aguardandoTerceiro
//   cob       → LinhaGerencial.acompanhamentoVencido, ativas, contado em lote
//   esc       → LinhaGerencial.escalada, ativas, contado em lote
//   risco     → PROCESSOS distintos com ao menos uma tarefa `emRisco`
//   backlog   → abertas nesta semana vs. concluídas com sucesso nesta semana
//
// TORRE NOVA (M4, 01/10/2026) — a foto ganhou os TOTAIS DA VISÃO GERAL, com a MESMA definição dos cartões:
//   processosAtivos → processos não concluídos, não pausados E fora de "Aguardando fechamento" (`ONDE_PROCESSO_ATIVO_DA_TORRE`, a lista do Radar/Processos)
//   tarefasAbertas  → `numeroDoKpi('abertas')`   comEquipe → 'equipe'   comCartorio → 'cartorio' (aguardando terceiros, COM responsável)
//   O cartão "Sem responsável" é `semDono` (mesma definição: 'ninguem') e "Aguardando terceiros" com ou sem dono segue em `aguardandoTerceiro`.
// Colunas NULLABLE: foto anterior à M4 não tem estes números e NUNCA é preenchida depois — sem tendência, não estimativa.
//
// `escalada`/`acompanhamentoVencido`/`emRisco` só existem depois do
// enriquecimento temporal (`enriquecerLinhas`), que `visaoGerencial` já faz —
// por isso o lote pagina por ela em vez de reimplementar o cálculo.
// ============================================================================
import { prisma } from '@/lib/prisma'
import { kpisDasLinhas, totaisDaSituacao } from './torre-kpis'
import { listarTarefasDaTorre } from '@/src/services/torre-tarefas'
import { processosCriticos, anotarRisco, ONDE_PROCESSO_ATIVO_DA_TORRE } from './torre-processos'
import { ONDE_TAREFA_DE_PROCESSO_NA_TORRE } from '@/src/services/processo-pre-contrato'

const STATUS_CONCLUIDOS_SUCESSO = ['CONCLUIDO_RECEBIDO', 'CONCLUIDO_NAO_POSSUI'] as const

export interface IndicadoresDoDia {
  vencidas: number
  vencemEm7Dias: number
  semDono: number
  aguardandoTerceiro: number
  cobrancasPendentes: number
  escaladas: number
  emRisco: number
  backlogAbertas: number
  backlogFechadasNaSemana: number
  /** Torre nova (M4) — totais da Visão geral, gravados na foto daqui para frente. */
  processosAtivos: number
  tarefasAbertas: number
  comEquipe: number
  comCartorio: number
}

const inicioDaSemana = (d: Date) => {
  const x = new Date(d)
  const dia = (x.getDay() + 6) % 7 // 0 = segunda
  x.setDate(x.getDate() - dia)
  x.setHours(0, 0, 0, 0)
  return x
}

/** CALCULA os 8 indicadores + backlog, AO VIVO — a mesma função que o cron
 * grava também serve para conferir "hoje" sem esperar a foto do dia. */
export async function calcularIndicadoresDoDia(agora = new Date()): Promise<IndicadoresDoDia> {
  const inicioSemana = inicioDaSemana(agora)

  // OS 7 PRIMEIROS vêm de `kpisDasLinhas` sobre as MESMAS linhas da aba Tarefas — a mesma função que dá o número
  // do cartão e a lista que o clique filtra (Bloco J3): foto, cartão e lista nunca discordam.
  const [{ linhas: brutas }, criticos, processosAtivos, backlogAbertas, backlogFechadas] = await Promise.all([
    listarTarefasDaTorre({}, agora),
    processosCriticos(agora),
    prisma.processo.count({ where: ONDE_PROCESSO_ATIVO_DA_TORRE }),
    // Backlog da semana: também fora da Torre o processo pausado e o em Aguardando fechamento (o mesmo filtro das listas).
    prisma.tarefa.count({ where: { createdAt: { gte: inicioSemana }, AND: [ONDE_TAREFA_DE_PROCESSO_NA_TORRE] } }),
    prisma.tarefa.count({ where: { statusTarefa: { in: [...STATUS_CONCLUIDOS_SUCESSO] }, dataConclusao: { gte: inicioSemana }, AND: [ONDE_TAREFA_DE_PROCESSO_NA_TORRE] } }),
  ])
  const linhas = anotarRisco(brutas, criticos)
  return { ...kpisDasLinhas(linhas, agora), ...totaisDaSituacao(linhas, agora), processosAtivos, backlogAbertas, backlogFechadasNaSemana: backlogFechadas }
}

/** GRAVA a foto do dia — idempotente por `data` (`@@unique`): reexecutar o
 * cron no mesmo dia operacional ATUALIZA a linha, nunca duplica. */
export async function gravarIndicadoresDoDia(agora = new Date()): Promise<{ data: string; indicadores: IndicadoresDoDia }> {
  const indicadores = await calcularIndicadoresDoDia(agora)
  const dia = new Date(agora)
  dia.setUTCHours(0, 0, 0, 0)

  await prisma.torreIndicadorDiario.upsert({
    where: { data: dia },
    create: {
      data: dia,
      vencidas: indicadores.vencidas, vencemEm7Dias: indicadores.vencemEm7Dias, semDono: indicadores.semDono,
      aguardandoTerceiro: indicadores.aguardandoTerceiro, cobrancasPendentes: indicadores.cobrancasPendentes,
      escaladas: indicadores.escaladas, emRisco: indicadores.emRisco,
      backlogAbertas: indicadores.backlogAbertas, backlogFechadasNaSemana: indicadores.backlogFechadasNaSemana,
      processosAtivos: indicadores.processosAtivos, tarefasAbertas: indicadores.tarefasAbertas,
      comEquipe: indicadores.comEquipe, comCartorio: indicadores.comCartorio,
    },
    update: {
      vencidas: indicadores.vencidas, vencemEm7Dias: indicadores.vencemEm7Dias, semDono: indicadores.semDono,
      aguardandoTerceiro: indicadores.aguardandoTerceiro, cobrancasPendentes: indicadores.cobrancasPendentes,
      escaladas: indicadores.escaladas, emRisco: indicadores.emRisco,
      backlogAbertas: indicadores.backlogAbertas, backlogFechadasNaSemana: indicadores.backlogFechadasNaSemana,
      processosAtivos: indicadores.processosAtivos, tarefasAbertas: indicadores.tarefasAbertas,
      comEquipe: indicadores.comEquipe, comCartorio: indicadores.comCartorio,
    },
  })
  return { data: dia.toISOString().slice(0, 10), indicadores }
}

export interface TendenciaDoKpi {
  data: string
  vencidas: number
  vencemEm7Dias: number
  semDono: number
  aguardandoTerceiro: number
  cobrancasPendentes: number
  escaladas: number
  emRisco: number
  backlogAbertas: number
  backlogFechadasNaSemana: number
  /** Torre nova (M4): `null` = foto anterior à M4 (não tem o número; sem tendência). */
  processosAtivos: number | null
  tarefasAbertas: number | null
  comEquipe: number | null
  comCartorio: number | null
}

/** A SÉRIE, mais recente primeiro — é o que alimenta "▲/▼ vs semana passada". */
export async function serieDeIndicadores(dias = 14): Promise<TendenciaDoKpi[]> {
  const linhas = await prisma.torreIndicadorDiario.findMany({
    orderBy: { data: 'desc' },
    take: Math.min(Math.max(dias, 1), 90),
  })
  return linhas.map((l) => ({
    data: l.data.toISOString().slice(0, 10),
    vencidas: l.vencidas, vencemEm7Dias: l.vencemEm7Dias, semDono: l.semDono,
    aguardandoTerceiro: l.aguardandoTerceiro, cobrancasPendentes: l.cobrancasPendentes,
    escaladas: l.escaladas, emRisco: l.emRisco,
    backlogAbertas: l.backlogAbertas, backlogFechadasNaSemana: l.backlogFechadasNaSemana,
    processosAtivos: l.processosAtivos, tarefasAbertas: l.tarefasAbertas, comEquipe: l.comEquipe, comCartorio: l.comCartorio,
  }))
}
