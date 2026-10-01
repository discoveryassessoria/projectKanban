// lib/operacional/torre-tendencias.ts
// ============================================================================
// TENDÊNCIA DOS KPIs — Bloco J3. A foto de HÓJE não é lida do banco: a tela já tem os números (mesmas
// linhas). Aqui vem só o que a tela NÃO tem: a foto de referência (semana passada, E10) e o backlog da semana.
// Sem foto de referência → `referencia: null` e a tela mostra "sem histórico". Nada é estimado.
// ============================================================================
import { prisma } from '@/lib/prisma'
import { serieDeIndicadores } from './indicadores-diarios'
import { fotoDeReferencia } from './torre-kpis'
import { ONDE_TAREFA_DE_PROCESSO_NA_TORRE } from '@/src/services/processo-pre-contrato'

const STATUS_CONCLUIDOS_SUCESSO = ['CONCLUIDO_RECEBIDO', 'CONCLUIDO_NAO_POSSUI'] as const

/** A segunda-feira 00:00 da semana de `d` — a ÚNICA definição (o funil importa daqui: "abre/fecha" nunca diverge). */
export const inicioDaSemana = (d: Date): Date => {
  const x = new Date(d)
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7))
  x.setHours(0, 0, 0, 0)
  return x
}

export async function tendenciasDaTorre(agora = new Date()) {
  const [serie, abertas, fechadas] = await Promise.all([
    serieDeIndicadores(30),
    // O backlog da semana também deixa de fora a tarefa de processo PAUSADO ou em AGUARDANDO FECHAMENTO (fora da Torre — o mesmo filtro
    // das listas e da foto diária): "abre/fecha" nunca diverge do que a Torre mostra.
    prisma.tarefa.count({ where: { createdAt: { gte: inicioDaSemana(agora) }, AND: [ONDE_TAREFA_DE_PROCESSO_NA_TORRE] } }),
    prisma.tarefa.count({ where: { statusTarefa: { in: [...STATUS_CONCLUIDOS_SUCESSO] }, dataConclusao: { gte: inicioDaSemana(agora) }, AND: [ONDE_TAREFA_DE_PROCESSO_NA_TORRE] } }),
  ])
  const referencia = fotoDeReferencia(serie, agora)
  return {
    /** Backlog da SEMANA CORRENTE, ao vivo: abertas (criadas) × fechadas com sucesso (cancelada nunca conta). */
    backlog: { abertas, fechadas },
    /** A foto de ~7 dias atrás (E10), ou `null` = sem histórico suficiente. */
    referencia,
    fotosNaSerie: serie.length,
  }
}
