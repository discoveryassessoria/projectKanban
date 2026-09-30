// lib/operacional/indicadores-diarios.ts
// ============================================================================
// SÉRIE DIÁRIA DOS INDICADORES DA TORRE — Bloco E10 (29/09/2026).
//
// UMA FONTE POR DADO (Regra 5 do mandato): os 8 KPIs vêm das MESMAS
// projeções que a Operação já usa — `indicadoresGerenciais`/`visaoGerencial`
// (`lib/operacional/tarefa-projecoes.ts`). Nada recalculado aqui.
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
// `escalada`/`acompanhamentoVencido`/`emRisco` só existem depois do
// enriquecimento temporal (`enriquecerLinhas`), que `visaoGerencial` já faz —
// por isso o lote pagina por ela em vez de reimplementar o cálculo.
// ============================================================================
import { prisma } from '@/lib/prisma'
import { indicadoresGerenciais, visaoGerencial } from './tarefa-projecoes'
import { STATUS_ATIVOS } from './tarefa-canonica'

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
}

const inicioDaSemana = (d: Date) => {
  const x = new Date(d)
  const dia = (x.getDay() + 6) % 7 // 0 = segunda
  x.setDate(x.getDate() - dia)
  x.setHours(0, 0, 0, 0)
  return x
}

/** Pagina `visaoGerencial` por TODAS as tarefas ativas, contando o que só
 * existe depois do enriquecimento temporal — sem reimplementar o cálculo. */
async function contarPorEnriquecimento(agora: Date): Promise<{ cobrancasPendentes: number; escaladas: number; processosEmRisco: Set<number> }> {
  let cobrancasPendentes = 0, escaladas = 0
  const processosEmRisco = new Set<number>()
  let pagina = 1
  const porPagina = 500
  for (;;) {
    const r = await visaoGerencial({ status: [...STATUS_ATIVOS], pagina, porPagina }, agora)
    for (const l of r.linhas) {
      if (l.acompanhamentoVencido) cobrancasPendentes++
      if (l.escalada) escaladas++
      if (l.emRisco && l.processoId != null) processosEmRisco.add(l.processoId)
    }
    if (pagina * porPagina >= r.total) break
    pagina++
  }
  return { cobrancasPendentes, escaladas, processosEmRisco }
}

/** CALCULA os 8 indicadores + backlog, AO VIVO — a mesma função que o cron
 * grava também serve para conferir "hoje" sem esperar a foto do dia. */
export async function calcularIndicadoresDoDia(agora = new Date()): Promise<IndicadoresDoDia> {
  const inicioSemana = inicioDaSemana(agora)

  const [gerais, v7, enriquecidos, backlogAbertas, backlogFechadas] = await Promise.all([
    indicadoresGerenciais({}, agora),
    visaoGerencial({ proximos7Dias: true, porPagina: 1 }, agora),
    contarPorEnriquecimento(agora),
    prisma.tarefa.count({ where: { createdAt: { gte: inicioSemana } } }),
    prisma.tarefa.count({ where: { statusTarefa: { in: [...STATUS_CONCLUIDOS_SUCESSO] }, dataConclusao: { gte: inicioSemana } } }),
  ])

  return {
    vencidas: gerais.atrasadas,
    vencemEm7Dias: v7.total,
    semDono: gerais.semResponsavel,
    aguardandoTerceiro: gerais.aguardandoTerceiro,
    cobrancasPendentes: enriquecidos.cobrancasPendentes,
    escaladas: enriquecidos.escaladas,
    emRisco: enriquecidos.processosEmRisco.size,
    backlogAbertas,
    backlogFechadasNaSemana: backlogFechadas,
  }
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
    },
    update: {
      vencidas: indicadores.vencidas, vencemEm7Dias: indicadores.vencemEm7Dias, semDono: indicadores.semDono,
      aguardandoTerceiro: indicadores.aguardandoTerceiro, cobrancasPendentes: indicadores.cobrancasPendentes,
      escaladas: indicadores.escaladas, emRisco: indicadores.emRisco,
      backlogAbertas: indicadores.backlogAbertas, backlogFechadasNaSemana: indicadores.backlogFechadasNaSemana,
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
  }))
}
