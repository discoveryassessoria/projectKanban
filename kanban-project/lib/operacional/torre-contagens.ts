// lib/operacional/torre-contagens.ts
// ============================================================================
// AS CONTAGENS DA TORRE — UMA FUNÇÃO POR CONTAGEM (07/10/2026). PURO. Antes cada aba contava do seu jeito: o funil ignorava «sem dono» e dizia 1 · 1 · 1, Processos o fazia
// virar «parado» e dizia 1 · 0 · 2; o topo dizia «Emissão 2 processos» (histórico) e o funil 3 (agora); «Famílias 5» mostrava 3. Aqui:
//   • `contarPorFase`        — processos ATIVOS por fase × nível de risco (+ quantos sem dono): funil, Processos (botões/filtros/saúde), Radar, topo;
//   • `contarTotais`         — os mesmos números para um conjunto qualquer de processos (um país, uma fase, a Torre toda);
//   • `contarPorResponsavel` — tarefas abertas e processos por pessoa (a leitura de responsável é `responsavel-canonico.ts`);
//   • `contarSemResponsavel` — tarefas e processos sem dono: o ÚNICO lugar que mostra «sem responsável» (as outras abas só fazem link para ele).
// «Processos» = processos ativos NA fase agora. Histórico (tempo médio) é outra coisa e tem texto próprio: «N permanências de M processos».
// Tarefa aberta, vencida ou sem responsável NUNCA é erro: é só número.
// ============================================================================
import { ehGrave, precisaDeAlguem, type NivelDeRisco } from './torre-risco'

export interface ProcessoParaContagem {
  faseAtualKey: string | null
  nivelDeRisco: NivelDeRisco
  semDono: boolean
}

export interface ContagemDeRisco {
  total: number
  noRitmo: number
  atencao: number
  parados: number
  criticos: number
  /** parado + crítico — o «em risco». */
  graves: number
  /** tudo que não está no ritmo — «Precisam de alguém». */
  precisam: number
  /** Processos com trabalho na fase e NINGUÉM como dono (atributo, não nível). */
  semDono: number
}
export interface ContagemPorFase extends ContagemDeRisco { key: string }

const VAZIA = (): ContagemDeRisco => ({ total: 0, noRitmo: 0, atencao: 0, parados: 0, criticos: 0, graves: 0, precisam: 0, semDono: 0 })

function somar(c: ContagemDeRisco, p: ProcessoParaContagem) {
  c.total++
  if (p.nivelDeRisco === 'no_ritmo') c.noRitmo++
  else if (p.nivelDeRisco === 'atencao') c.atencao++
  else if (p.nivelDeRisco === 'parado') c.parados++
  else c.criticos++
  if (ehGrave(p.nivelDeRisco)) c.graves++
  if (precisaDeAlguem(p.nivelDeRisco)) c.precisam++
  if (p.semDono) c.semDono++
}

/** Os números de um conjunto de processos (uma fase, um país, a Torre toda). */
export function contarTotais(processos: ReadonlyArray<ProcessoParaContagem>): ContagemDeRisco {
  const c = VAZIA()
  for (const p of processos) somar(c, p)
  return c
}

/** Processos ATIVOS por fase, na ordem da lista única de fases; `foraDaLista` = processo cuja fase não está nela (aparece avisado, nunca some). */
export function contarPorFase(processos: ReadonlyArray<ProcessoParaContagem>, fases: ReadonlyArray<{ key: string }>): { linhas: ContagemPorFase[]; foraDaLista: number } {
  const porChave = new Map<string, ContagemDeRisco>(fases.map((f) => [f.key, VAZIA()]))
  let foraDaLista = 0
  for (const p of processos) {
    const c = p.faseAtualKey != null ? porChave.get(p.faseAtualKey) : undefined
    if (!c) { foraDaLista++; continue }
    somar(c, p)
  }
  return { linhas: fases.map((f) => ({ key: f.key, ...porChave.get(f.key)! })), foraDaLista }
}

export interface ProcessoParaResponsavel { responsaveis: { donos: Array<{ id: number; nome: string; n: number }>; semDono: number } | null }
export interface ContagemDoResponsavel { id: number; nome: string; tarefas: number; processos: number }

/** Por pessoa: tarefas abertas e em quantos processos ela tem tarefa aberta. */
export function contarPorResponsavel(processos: ReadonlyArray<ProcessoParaResponsavel>): ContagemDoResponsavel[] {
  const por = new Map<number, ContagemDoResponsavel>()
  for (const p of processos) for (const d of p.responsaveis?.donos ?? []) {
    const c = por.get(d.id) ?? { id: d.id, nome: d.nome, tarefas: 0, processos: 0 }
    c.tarefas += d.n; c.processos++
    por.set(d.id, c)
  }
  return [...por.values()].sort((a, b) => b.tarefas - a.tarefas || a.nome.localeCompare(b.nome, 'pt-BR'))
}

/** Sem responsável: tarefas abertas sem dono e processos que têm ao menos uma. */
export function contarSemResponsavel(processos: ReadonlyArray<ProcessoParaResponsavel>): { tarefas: number; processos: number } {
  let tarefas = 0, procs = 0
  for (const p of processos) { const s = p.responsaveis?.semDono ?? 0; tarefas += s; if (s > 0) procs++ }
  return { tarefas, processos: procs }
}

/** O texto do tempo médio (histórico): nunca chama de «processos» o que são permanências. «12 dias · 6 permanências de 5 processos». */
export function textoDasPermanencias(mediaTexto: string, permanencias: number, processos: number): string {
  const perm = permanencias === 1 ? '1 permanência' : `${permanencias} permanências`
  const proc = processos === 1 ? '1 processo concluído' : `${processos} processos concluídos`
  return `${mediaTexto} · ${perm} de ${proc}`
}

/** O «Precisa de você»: DECISÕES (itens) e quantos PROCESSOS elas tocam. «Em risco» conta processos graves; «Precisa de você» conta decisões — nunca o mesmo número com o mesmo nome. */
export function contarDecisoes(itens: ReadonlyArray<{ processoId?: number | null }>): { decisoes: number; processos: number } {
  return { decisoes: itens.length, processos: new Set(itens.map((i) => i.processoId).filter((x): x is number => x != null)).size }
}
export const textoDasDecisoes = (c: { decisoes: number; processos: number }): string =>
  `${c.decisoes} ${c.decisoes === 1 ? 'decisão' : 'decisões'}${c.processos > 0 ? ` em ${c.processos} ${c.processos === 1 ? 'processo' : 'processos'}` : ''}`
