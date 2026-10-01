// lib/operacional/torre-funil.ts
// ============================================================================
// FUNIL POR FASE — a LEITURA (servidor). Torre nova, frente B1 (01/10/2026). Só leitura, 5 consultas constantes (sem N+1).
//
// O que a tela NÃO tem e vem daqui (o resto — total, barra de risco, gargalo — ela deriva das MESMAS listas da Torre,
// ver `torre-funil-puro.ts`):
//   · as FASES do cadastro (`CatalogoFase` ativo, na ordem), sem a fase TERMINAL (sem próxima fase no catálogo: "Finalizado" —
//     o processo que chega nela deixa de ser ativo);
//   · o TEMPO MÉDIO REAL por fase = média das permanências CONCLUÍDAS (`PhaseAdvanceLog`), geral e por país;
//   · a META de cada fase (cadastro de metas: a do país, senão a padrão, senão `null`) — SÓ EXIBIÇÃO;
//   · a SEMANA: processos abertos, processos que chegaram em "Protocolado", e as tarefas abertas × fechadas (a MESMA conta de
//     `tendenciasDaTorre`: criadas / concluídas com sucesso desde a segunda-feira; cancelada nunca é fechada).
// ============================================================================
import { prisma } from '@/lib/prisma'
import { FASES, phaseKeyToFaseCode } from '@/src/lib/process-stage/fases-catalog'
import { fasesDoRadar } from './torre-processos'
import { metasAtivas, resolverMeta } from './torre-metas'
import { RESULTADOS_QUE_MOVEM_DE_FASE } from './metricas-processo'
import {
  ESCOPO_VAZIO, permanenciasConcluidas, tempoMedioPorFase,
  type DadosDoFunilPorEscopo, type FaseDoCadastro, type RespostaDoFunil, type Permanencia,
} from './torre-funil-puro'

const STATUS_CONCLUIDOS_SUCESSO = ['CONCLUIDO_RECEBIDO', 'CONCLUIDO_NAO_POSSUI'] as const

/** A segunda-feira 00:00 da semana de `d` — A MESMA de `tendenciasDaTorre` (torre-tendencias.ts), para "abre/fecha" nunca divergir. */
export function inicioDaSemana(d: Date): Date {
  const x = new Date(d)
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7))
  x.setHours(0, 0, 0, 0)
  return x
}

const ORDEM_DA_ULTIMA_FASE = Math.max(...Object.values(FASES).map((f) => f.ordem))

/** A fase é TERMINAL no catálogo (a de maior ordem; Análise tem `next: null` por ramificar, mas não é o fim)? O processo que chega nela deixa de ser ativo — não é etapa do funil. */
export const faseTerminal = (phaseKey: string): boolean => {
  const code = phaseKeyToFaseCode(phaseKey)
  return code != null && FASES[code].ordem === ORDEM_DA_ULTIMA_FASE
}

/** A chave da fase "Protocolado" no catálogo em código (nunca literal solto na regra). */
export const FASE_PROTOCOLADA: string = FASES.PROTOCOLADO.phaseKey

export async function funilDaTorre(agora = new Date()): Promise<RespostaDoFunil> {
  const inicio = inicioDaSemana(agora)
  const [todasAsFases, metas, paises, logs, processos, protocoladosLogs, tarefasAbertas, tarefasFechadas] = await Promise.all([
    fasesDoRadar(),
    metasAtivas(),
    prisma.catalogoPais.findMany({ where: { ativo: true }, select: { id: true, countryLabel: true } }),
    prisma.phaseAdvanceLog.findMany({
      where: { resultado: { in: [...RESULTADOS_QUE_MOVEM_DE_FASE] } },
      select: { processoId: true, faseAtual: true, fasePretendida: true, criadoEm: true },
    }),
    prisma.processo.findMany({ select: { id: true, createdAt: true, paisCanonico: { select: { countryLabel: true } } } }),
    prisma.phaseAdvanceLog.findMany({
      where: { resultado: { in: [...RESULTADOS_QUE_MOVEM_DE_FASE] }, fasePretendida: FASE_PROTOCOLADA, criadoEm: { gte: inicio } },
      select: { processoId: true },
    }),
    prisma.tarefa.findMany({ where: { createdAt: { gte: inicio } }, select: { processoId: true } }),
    prisma.tarefa.findMany({ where: { statusTarefa: { in: [...STATUS_CONCLUIDOS_SUCESSO] }, dataConclusao: { gte: inicio } }, select: { processoId: true } }),
  ])

  const fases: FaseDoCadastro[] = todasAsFases.filter((f) => !faseTerminal(f.key)).map((f) => ({ key: f.key, label: f.label, condicional: f.condicional }))
  const paisDoProcesso = new Map<number, string | null>(processos.map((p) => [p.id, p.paisCanonico?.countryLabel ?? null]))

  const escopo = (rotulo: string | null, paisId: number | null): DadosDoFunilPorEscopo => {
    const noEscopo = (processoId: number | null) => rotulo == null || (processoId != null && paisDoProcesso.get(processoId) === rotulo)
    const perm: Permanencia[] = permanenciasConcluidas(logs.filter((l) => noEscopo(l.processoId)))
    return {
      tempos: tempoMedioPorFase(perm),
      metas: Object.fromEntries(fases.map((f) => [f.key, resolverMeta(metas, f.key, paisId)])),
      semana: {
        processosAbertos: processos.filter((p) => p.createdAt >= inicio && noEscopo(p.id)).length,
        protocolados: new Set(protocoladosLogs.filter((l) => noEscopo(l.processoId)).map((l) => l.processoId)).size,
        tarefasAbertas: tarefasAbertas.filter((t) => rotulo == null || noEscopo(t.processoId)).length,
        tarefasFechadas: tarefasFechadas.filter((t) => rotulo == null || noEscopo(t.processoId)).length,
      },
    }
  }
  const porPais: Record<string, DadosDoFunilPorEscopo> = {}
  for (const p of paises) porPais[p.countryLabel] = escopo(p.countryLabel, p.id)
  return { fases, inicioDaSemana: inicio.toISOString(), geral: escopo(null, null), porPais }
}

export { ESCOPO_VAZIO }
