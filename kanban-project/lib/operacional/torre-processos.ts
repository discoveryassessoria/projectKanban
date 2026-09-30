// lib/operacional/torre-processos.ts
// ============================================================================
// RADAR E PROCESSOS DA TORRE — Bloco J4 (30/09/2026). Só leitura, tudo das fontes que já existem:
//   • as linhas de tarefa: as MESMAS da aba Tarefas (`listarTarefasDaTorre`);
//   • progresso real, dias na fase e próximo marco: Bloco E9 (`metricas-processo`);
//   • risco: o MESMO score do "Precisa de você" (`itensPrecisaDeVoce`, Bloco F) — a maior pontuação entre
//     os itens do processo, mesmas faixas (≥6 crítico, ≥3 atenção);
//   • as colunas do Radar: as fases ATIVAS do cadastro (`CatalogoFase`) na ordem padrão; a fase de um
//     processo que o macrofluxo do tipo dele não tem aparece como "não se aplica" (nada de fase inventada);
//   • "sem passos": fase futura com achado aberto CAD-012/WF-004 do Saúde (a "parede à frente").
// ============================================================================
import { prisma } from '@/lib/prisma'
import { labelDaFasePorPhaseKey } from '@/src/lib/process-stage/fases-catalog'
import { ordensDeFase } from '@/src/services/documento-operacao'
import { listarTarefasDaTorre, type LinhaDaTorre } from '@/src/services/torre-tarefas'
import { itensPrecisaDeVoce, faixaDoScore } from './precisa-de-voce'
import { progressoRealDoProcesso, diasNaFaseAtual, proximoMarco } from './metricas-processo'

export type RiscoDoProcesso = 'ok' | 'atencao' | 'critico'

export interface ColunaDoRadar { key: string; label: string; condicional: boolean }

export interface CelulaDoRadar {
  /** feita = fase já passou · atual = onde o processo está · futura · na = o macrofluxo deste tipo não tem a fase */
  estado: 'feita' | 'atual' | 'futura' | 'na'
  /** Só na atual: com quem está a bola e há quantos dias. */
  bola?: string
  dias?: number | null
  horas?: number | null
  risco?: RiscoDoProcesso
  /** Só nas futuras: a fase não tem passo executável (achado aberto CAD-012/WF-004). */
  semPassos?: boolean
}

export interface ProcessoDaTorre {
  processoId: number
  familiaId: number | null
  familiaNome: string
  pais: string | null
  codigo: string | null
  faseAtual: { key: string | null; label: string | null }
  progresso: { recebidas: number; requeridas: number; percentual: number }
  diasNaFase: number | null
  /** Quando entrou na fase atual (de registro real) — `null` = sem registro, a tela mostra "—". */
  naFase: { desde: string | null; origem: string | null; dias: number | null; horas: number | null }
  bola: { rotulo: string; dias: number | null }
  risco: RiscoDoProcesso
  scoreMaximo: number
  proximoMarco: string | null
  numeros: { abertas: number; vencidas: number; comCartorio: number; semResponsavel: number }
  celulas: CelulaDoRadar[]
}

/** DE QUEM É A BOLA no processo — a mesma leitura das linhas: cartório, cliente ou nossa. */
export function bolaDoProcesso(linhas: Array<Pick<LinhaDaTorre, 'estadoOperacao' | 'esperandoDe' | 'esperandoHaDias'>>): { rotulo: string; dias: number | null } {
  if (linhas.length === 0) return { rotulo: 'Nossa', dias: null }
  const esperandoTerceiro = linhas.filter((l) => l.esperandoDe === 'terceiro')
  const esperandoCliente = linhas.filter((l) => l.esperandoDe === 'cliente')
  const maxDias = (ls: typeof linhas) => { const d = ls.map((l) => l.esperandoHaDias).filter((x): x is number => x != null); return d.length ? Math.max(...d) : null }
  // Metade ou mais das tarefas abertas esperando o terceiro: a bola está com o cartório (a regra do protótipo).
  if (esperandoTerceiro.length * 2 >= linhas.length) return { rotulo: 'Cartório', dias: maxDias(esperandoTerceiro) }
  if (esperandoCliente.length * 2 >= linhas.length) return { rotulo: 'Cliente', dias: maxDias(esperandoCliente) }
  return { rotulo: 'Nossa', dias: null }
}

export async function fasesDoRadar(): Promise<ColunaDoRadar[]> {
  const fases = await prisma.catalogoFase.findMany({ where: { ativo: true }, orderBy: [{ ordemPadrao: 'asc' }, { id: 'asc' }], select: { phaseKey: true, label: true, conditionalPadrao: true } })
  return fases.map((f) => ({ key: f.phaseKey, label: f.label, condicional: f.conditionalPadrao }))
}

async function fasesSemPassos(agora: Date): Promise<Set<string>> {
  const achados = await prisma.saudeAchado.findMany({
    where: { codigo: { in: ['CAD-012', 'WF-004'] }, status: { not: 'RESOLVIDO' }, OR: [{ status: { not: 'IGNORADO' } }, { ignoradoAte: { lt: agora } }] },
    select: { evidencia: true },
  })
  const fases = new Set<string>()
  for (const a of achados) {
    const e = (a.evidencia ?? {}) as { fase?: string; phaseKey?: string }
    const k = e.fase ?? e.phaseKey
    if (k) fases.add(k)
  }
  return fases
}

/** Os processos de risco CRÍTICO (score ≥ 6 do "Precisa de você"). Uma definição para o cartão, o Radar, a aba Processos e a foto E10. */
export async function processosCriticos(agora = new Date()): Promise<Set<number>> {
  const itens = await itensPrecisaDeVoce({ agora })
  const max = new Map<number, number>()
  for (const i of itens) if (i.processoId != null) max.set(i.processoId, Math.max(max.get(i.processoId) ?? 0, i.score))
  return new Set([...max].filter(([, score]) => faixaDoScore(score) === 'CRITICO').map(([id]) => id))
}

/** Anota cada linha com `processoEmRisco` — para o cartão "Processos em risco" e o filtro dele. */
export function anotarRisco<T extends { processoId: number | null }>(linhas: T[], criticos: Set<number>): Array<T & { processoEmRisco: boolean }> {
  return linhas.map((l) => ({ ...l, processoEmRisco: l.processoId != null && criticos.has(l.processoId) }))
}

export async function processosDaTorre(agora = new Date(), linhasEntrada?: LinhaDaTorre[]): Promise<{ colunas: ColunaDoRadar[]; processos: ProcessoDaTorre[] }> {
  const [colunas, linhas, semPassos] = await Promise.all([
    fasesDoRadar(),
    linhasEntrada ? Promise.resolve(linhasEntrada) : listarTarefasDaTorre({}, agora).then((r) => r.linhas),
    fasesSemPassos(agora),
  ])
  const procs = await prisma.processo.findMany({
    where: { dataConclusao: null },
    orderBy: { id: 'asc' }, take: 300,
    select: { id: true, nome: true, codigo: true, faseAtualKey: true, tipoProcessoMotorId: true, familiaId: true, familia: { select: { nome: true } }, paisCanonico: { select: { countryLabel: true } } },
  })
  const itensF = await itensPrecisaDeVoce({ agora })
  const scorePorProcesso = new Map<number, number>()
  for (const i of itensF) if (i.processoId != null) scorePorProcesso.set(i.processoId, Math.max(scorePorProcesso.get(i.processoId) ?? 0, i.score))

  const ordensPorTipo = new Map<number, Map<string, number>>()
  for (const t of new Set(procs.map((p) => p.tipoProcessoMotorId).filter((x): x is number => x != null))) ordensPorTipo.set(t, await ordensDeFase(t))

  const linhasPorProcesso = new Map<number, LinhaDaTorre[]>()
  for (const l of linhas) if (l.processoId != null) linhasPorProcesso.set(l.processoId, [...(linhasPorProcesso.get(l.processoId) ?? []), l])

  const montar = async (p: (typeof procs)[number]): Promise<ProcessoDaTorre> => {
    const ls = linhasPorProcesso.get(p.id) ?? []
    const [prog, dias, marco] = await Promise.all([progressoRealDoProcesso(p.id), diasNaFaseAtual(p.id, agora), proximoMarco(p.id)])
    const score = scorePorProcesso.get(p.id) ?? 0
    const faixa = faixaDoScore(score)
    const risco: RiscoDoProcesso = faixa === 'CRITICO' ? 'critico' : faixa === 'ATENCAO' ? 'atencao' : 'ok'
    const bola = bolaDoProcesso(ls)
    const ordens = p.tipoProcessoMotorId != null ? ordensPorTipo.get(p.tipoProcessoMotorId) : undefined
    const ordemAtual = p.faseAtualKey ? ordens?.get(p.faseAtualKey) : undefined
    const celulas: CelulaDoRadar[] = colunas.map((c): CelulaDoRadar => {
      const ordem = ordens?.get(c.key)
      if (ordem == null) return { estado: 'na' }
      if (c.key === p.faseAtualKey) return { estado: 'atual', bola: bola.rotulo, dias: dias.dias, horas: dias.horas, risco }
      if (ordemAtual != null && ordem < ordemAtual) return { estado: 'feita' }
      return { estado: 'futura', semPassos: semPassos.has(c.key) }
    })
    return {
      processoId: p.id, familiaId: p.familiaId, familiaNome: p.familia?.nome ?? p.nome, pais: p.paisCanonico?.countryLabel ?? null, codigo: p.codigo,
      faseAtual: { key: p.faseAtualKey, label: p.faseAtualKey ? labelDaFasePorPhaseKey(p.faseAtualKey) ?? p.faseAtualKey : null },
      progresso: { recebidas: prog.completed, requeridas: prog.required, percentual: prog.percentage },
      diasNaFase: dias.dias, naFase: { desde: dias.desde, origem: dias.origem, dias: dias.dias, horas: dias.horas }, bola, risco, scoreMaximo: score, proximoMarco: marco,
      numeros: {
        abertas: ls.length, vencidas: ls.filter((l) => l.atrasada).length,
        comCartorio: ls.filter((l) => l.estadoOperacao === 'AGUARDANDO').length, semResponsavel: ls.filter((l) => l.responsavelId == null).length,
      },
      celulas,
    }
  }
  // Em blocos: cada processo faz consultas próprias (completude documental) e o pool de conexões é pequeno.
  const processos: ProcessoDaTorre[] = []
  for (let i = 0; i < procs.length; i += 4) processos.push(...(await Promise.all(procs.slice(i, i + 4).map(montar))))
  const peso: Record<RiscoDoProcesso, number> = { critico: 0, atencao: 1, ok: 2 }
  processos.sort((a, b) => peso[a.risco] - peso[b.risco] || b.scoreMaximo - a.scoreMaximo || a.familiaNome.localeCompare(b.familiaNome))
  return { colunas, processos }
}
