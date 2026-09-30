// lib/operacional/torre-topo.ts
// ============================================================================
// O TOPO DA TORRE (01/10/2026) — a frase fixa + as faixas SITUAÇÃO e AGENDA. PURO (sem Prisma): a tela e o teste usam
// as MESMAS funções. Os números vêm de `numeroDoKpi` (torre-kpis.ts) — a mesma conta que a aba Tarefas filtra.
// ============================================================================
import { CARTOES_DA_AGENDA, CARTOES_DA_SITUACAO, KPI_POR_CHAVE, emRiscoCritico, numeroDoKpi, type ChaveKpi, type LinhaParaKpi } from './torre-kpis'
import { FUSO_OPERACIONAL } from './tempo-operacional'

export interface LinhaParaTopo extends LinhaParaKpi {
  aIniciar: boolean
  statusTarefa: string
  familiaNome: string | null
  processoNome: string | null
}
export interface ProcessoParaTopo { risco: string; faseAtual: { label: string | null } }

export interface CartaoDoTopo { chave: ChaveKpi; rotulo: string; valor: number; regra: string }
export interface TopoDaTorre {
  frase: string
  processosAtivos: { total: number; distribuicao: string; emRisco: number }
  situacao: CartaoDoTopo[]
  agenda: CartaoDoTopo[]
}

/** "Tarefa a iniciar": a MESMA conta de `aIniciarEfetivo` da Operação (a iniciar e não "em andamento sem dono"). */
export const aIniciarNoTopo = (l: Pick<LinhaParaTopo, 'aIniciar' | 'statusTarefa' | 'responsavelId'>): boolean =>
  l.aIniciar && !(l.statusTarefa === 'EM_ANDAMENTO' && l.responsavelId == null)

const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`
export const LIMITE_DE_FAMILIAS_NA_FRASE = 3

/** "2 · Genealogia 1 · Emissão 1" — total, depois cada fase ATUAL com quantos processos (maior primeiro, empate por nome). */
export function distribuicaoPorFase(processos: ProcessoParaTopo[]): string {
  const por = new Map<string, number>()
  for (const p of processos) { const k = p.faseAtual.label ?? 'Sem fase'; por.set(k, (por.get(k) ?? 0) + 1) }
  const partes = [...por].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'pt-BR')).map(([k, n]) => `${k} ${n}`)
  return [String(processos.length), ...partes].join(' · ')
}

export function dataPorExtenso(agora: Date): string {
  return agora.toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', timeZone: FUSO_OPERACIONAL })
}

/** A FRASE FIXA: "Hoje, {data}: {N} certidão(ões) para iniciar ({famílias}), {N} atrasada(s), {N} com o cartório, {N} sem responsável." */
export function fraseDoDia(linhas: LinhaParaTopo[], agora: Date): string {
  const aIniciar = linhas.filter(aIniciarNoTopo)
  const familias = [...new Set(aIniciar.map((l) => l.familiaNome ?? l.processoNome ?? 'Sem família'))].sort((a, b) => a.localeCompare(b, 'pt-BR'))
  const n = (k: ChaveKpi) => numeroDoKpi(k, linhas, agora)
  const quais = familias.length === 0 ? '' : familias.length > LIMITE_DE_FAMILIAS_NA_FRASE ? ` (${familias.length} famílias)`
    : ` (${familias.length > 1 ? `${familias.slice(0, -1).join(', ')} e ${familias[familias.length - 1]}` : familias[0]})`
  const atr = n('venc')
  return `Hoje, ${dataPorExtenso(agora)}: ${plural(aIniciar.length, 'certidão', 'certidões')} para iniciar${quais}, ${plural(atr, 'atrasada', 'atrasadas')}, ${n('cartorio')} com o cartório, ${n('ninguem')} sem responsável.`
}

export function topoDaTorre(linhas: LinhaParaTopo[], processos: ProcessoParaTopo[], agora: Date): TopoDaTorre {
  const cartao = (chave: ChaveKpi): CartaoDoTopo => ({ chave, rotulo: KPI_POR_CHAVE[chave].rotulo, valor: numeroDoKpi(chave, linhas, agora), regra: KPI_POR_CHAVE[chave].regra })
  return {
    frase: fraseDoDia(linhas, agora),
    processosAtivos: { total: processos.length, distribuicao: distribuicaoPorFase(processos), emRisco: processos.filter(emRiscoCritico).length },
    situacao: CARTOES_DA_SITUACAO.map(cartao),
    agenda: CARTOES_DA_AGENDA.map(cartao),
  }
}
