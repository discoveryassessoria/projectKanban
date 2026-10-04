// lib/operacional/torre-funil.ts
// ============================================================================
// FUNIL POR FASE — a LEITURA (servidor). Torre nova, frente B1 (01/10/2026). Só leitura, 5 consultas constantes (sem N+1).
//
// O que a tela NÃO tem e vem daqui (o resto — total, barra de risco, gargalo — ela deriva das MESMAS listas da Torre,
// ver `torre-funil-puro.ts`):
//   · as FASES do cadastro (`CatalogoFase` ativo, na ordem), sem a fase TERMINAL (sem próxima fase no catálogo: "Finalizado" —
//     o processo que chega nela deixa de ser ativo);
//   · o TEMPO MÉDIO REAL por fase = média das permanências CONCLUÍDAS (`PhaseAdvanceLog`), geral e por país, SÓ de processos que estão
//     na Torre (fora dela = Aguardando fechamento e pausados, como nos contadores);
//   · a META de cada fase (cadastro de metas: a do país, senão a padrão, senão `null`) — SÓ EXIBIÇÃO;
//   · a SEMANA: processos abertos, processos que chegaram em "Protocolado", e as tarefas abertas × fechadas (a MESMA conta de
//     `tendenciasDaTorre`: criadas / concluídas com sucesso desde a segunda-feira; cancelada nunca é fechada) — SEM os processos
//     pausados nem os em "Aguardando fechamento" (fora da Torre, filtro canônico `processo-pre-contrato.ts`);
//   · "AGUARDANDO FECHAMENTO: N" — a linha PRÓPRIA (geral e por país), FORA do total e da barra de risco.
// ============================================================================
import { prisma } from '@/lib/prisma'
import { FASES, phaseKeyToFaseCode } from '@/src/lib/process-stage/fases-catalog'
import { fasesDoRadar } from './torre-processos'
import { metasAtivas, resolverMeta } from './torre-metas'
import { inicioDaSemana, ONDE_TAREFA_ABERTA_NA_SEMANA, ONDE_TAREFA_FECHADA_NA_SEMANA } from './torre-semana'
import { idsDeProcessosForaDaTorre, contarProcessosAguardandoFechamento } from '@/src/services/processo-pre-contrato'
import { RESULTADOS_QUE_MOVEM_DE_FASE } from './metricas-processo'
import {
  ESCOPO_VAZIO, permanenciasConcluidas, tempoMedioPorFase,
  type DadosDoFunilPorEscopo, type FaseDoCadastro, type RespostaDoFunil, type Permanencia,
} from './torre-funil-puro'


// `inicioDaSemana` mora em torre-tendencias.ts (a MESMA de `tendenciasDaTorre`, para "abre/fecha" nunca divergir).

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
  const [todasAsFases, metas, paises, logs, processos, protocoladosLogs, tarefasAbertas, tarefasFechadas, foraDaTorre, aguardandoGeral] = await Promise.all([
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
    prisma.tarefa.findMany({ where: ONDE_TAREFA_ABERTA_NA_SEMANA(inicio), select: { processoId: true } }),
    prisma.tarefa.findMany({ where: ONDE_TAREFA_FECHADA_NA_SEMANA(inicio), select: { processoId: true } }),
    idsDeProcessosForaDaTorre(),
    contarProcessosAguardandoFechamento(),
  ])

  const fases: FaseDoCadastro[] = todasAsFases.filter((f) => !faseTerminal(f.key)).map((f) => ({ key: f.key, label: f.label, condicional: f.condicional }))
  const paisDoProcesso = new Map<number, string | null>(processos.map((p) => [p.id, p.paisCanonico?.countryLabel ?? null]))

  const escopo = (rotulo: string | null, paisId: number | null, aguardandoFechamento: number): DadosDoFunilPorEscopo => {
    const noEscopo = (processoId: number | null) => rotulo == null || (processoId != null && paisDoProcesso.get(processoId) === rotulo)
    // Só processos DA TORRE: quem está fora dela (Aguardando fechamento, pausado) não entra no tempo médio — o MESMO recorte dos
    // contadores ("Todos 2", "Itália 2") e de tudo o mais na Torre. Sem isso o "Todos" mostrava um tempo de um processo que nem
    // aparece nas contagens (achado 04/10/2026: o Antão, da Espanha, em Aguardando fechamento, dava "4 dias · 1 processo").
    const perm: Permanencia[] = permanenciasConcluidas(logs.filter((l) => noEscopo(l.processoId) && !foraDaTorre.has(l.processoId)))
    return {
      tempos: tempoMedioPorFase(perm),
      metas: Object.fromEntries(fases.map((f) => [f.key, resolverMeta(metas, f.key, paisId)])),
      semana: {
        processosAbertos: processos.filter((p) => p.createdAt >= inicio && noEscopo(p.id) && !foraDaTorre.has(p.id)).length,
        protocolados: new Set(protocoladosLogs.filter((l) => noEscopo(l.processoId)).map((l) => l.processoId)).size,
        tarefasAbertas: tarefasAbertas.filter((t) => rotulo == null || noEscopo(t.processoId)).length,
        tarefasFechadas: tarefasFechadas.filter((t) => rotulo == null || noEscopo(t.processoId)).length,
      },
      aguardandoFechamento,
    }
  }
  const porPais: Record<string, DadosDoFunilPorEscopo> = {}
  const aguardandoPorPais = await Promise.all(paises.map((p) => contarProcessosAguardandoFechamento({ paisLabel: p.countryLabel })))
  paises.forEach((p, i) => { porPais[p.countryLabel] = escopo(p.countryLabel, p.id, aguardandoPorPais[i]) })
  return { fases, inicioDaSemana: inicio.toISOString(), geral: escopo(null, null, aguardandoGeral), porPais }
}

export { ESCOPO_VAZIO }
