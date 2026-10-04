// lib/operacional/torre-tendencias.ts
// ============================================================================
// TENDÊNCIA DOS KPIs — Bloco J3. A foto de HÓJE não é lida do banco: a tela já tem os números (mesmas
// linhas). Aqui vem só o que a tela NÃO tem: a foto de referência (semana passada, E10) e o backlog da semana.
// Sem foto de referência → `referencia: null` e a tela mostra "sem histórico". Nada é estimado.
// ============================================================================
import { prisma } from '@/lib/prisma'
import { serieDeIndicadores } from './indicadores-diarios'
import { fotoDeReferencia } from './torre-kpis'
import { inicioDaSemana, ONDE_TAREFA_ABERTA_NA_SEMANA, ONDE_TAREFA_FECHADA_NA_SEMANA } from './torre-semana'

// A semana (início, "abre", "fecha") mora em torre-semana.ts — a ÚNICA definição; reexportada aqui para quem já importava daqui.
export { inicioDaSemana, ONDE_TAREFA_ABERTA_NA_SEMANA, ONDE_TAREFA_FECHADA_NA_SEMANA } from './torre-semana'

export async function tendenciasDaTorre(agora = new Date()) {
  const [serie, abertas, fechadas] = await Promise.all([
    serieDeIndicadores(30),
    // O backlog da semana também deixa de fora a tarefa de processo PAUSADO ou em AGUARDANDO FECHAMENTO (fora da Torre — o mesmo filtro
    // das listas e da foto diária): "abre/fecha" nunca diverge do que a Torre mostra.
    prisma.tarefa.count({ where: ONDE_TAREFA_ABERTA_NA_SEMANA(inicioDaSemana(agora)) }),
    prisma.tarefa.count({ where: ONDE_TAREFA_FECHADA_NA_SEMANA(inicioDaSemana(agora)) }),
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
