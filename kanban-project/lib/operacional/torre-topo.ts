// lib/operacional/torre-topo.ts
// ============================================================================
// O TOPO DA VISÃO GERAL (Torre nova, frente B1, 01/10/2026) — a faixa "Hoje" + as faixas SITUAÇÃO e AGENDA. PURO (sem Prisma):
// a tela e o teste usam as MESMAS funções. Os números dos cartões vêm de `numeroDoKpi` (torre-kpis.ts) — a mesma conta que a aba
// Tarefas filtra —, e os detalhes (terceiros por lado, famílias sem responsável, países) saem das MESMAS linhas.
// ============================================================================
import { CARTOES_DA_AGENDA, CARTOES_DA_SITUACAO, KPI_POR_CHAVE, emRiscoCritico, numeroDoKpi, situacaoDaTarefa, type ChaveKpi, type LinhaParaKpi } from './torre-kpis'
import { VALORES_DE_BOLA, BOLA_NOSSA } from './torre-bola'
import { FUSO_OPERACIONAL } from './tempo-operacional'
import { textoDoGargaloNaFrase, type LinhaDoFunil } from './torre-funil-puro'

export interface LinhaParaTopo extends LinhaParaKpi {
  aIniciar: boolean
  statusTarefa: string
  familiaNome: string | null
  processoNome: string | null
  /** De quem é a bola (função única `torre-bola.ts`). Só a Situação "Aguardando terceiros" a lê. */
  bolaCom?: string
}
export interface ProcessoParaTopo { risco: string; pais?: string | null; faseAtual: { label: string | null } }

export interface CartaoDoTopo { chave: ChaveKpi; rotulo: string; valor: number; regra: string }
export interface TopoDaTorre {
  frase: string
  processosAtivos: { total: number; distribuicao: string; emRisco: number }
  situacao: CartaoDoTopo[]
  agenda: CartaoDoTopo[]
}

export function dataPorExtenso(agora: Date): string {
  return agora.toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', timeZone: FUSO_OPERACIONAL })
}

// ─── números e plurais ──────────────────────────────────────────────────────────────────────────────────────────────────
/** 2328 → "2.328" (ponto de milhar à mão: idêntico no servidor e no navegador, sem depender de ICU). */
export const milhar = (n: number): string => String(Math.trunc(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.')
const plural = (n: number, um: string, varios: string) => `${milhar(n)} ${n === 1 ? um : varios}`

// ─── SITUAÇÃO: os detalhes de cada cartão ───────────────────────────────────────────────────────────────────────────────
/** "Itália 280 · Espanha 140 · Portugal 55" — processos ativos por país (maior primeiro, empate por nome). Sem processo: "". */
export function distribuicaoPorPais(processos: Array<{ pais?: string | null }>): string {
  const por = new Map<string, number>()
  for (const p of processos) { const k = p.pais ?? 'Sem país'; por.set(k, (por.get(k) ?? 0) + 1) }
  return [...por].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'pt-BR')).map(([k, n]) => `${k} ${milhar(n)}`).join(' · ')
}

/**
 * "cartório 2.139 · cliente 94 · tradutor 57 · juízo 29 · consulado 9" — as tarefas do cartão "Aguardando terceiros" repartidas pela BOLA
 * (`torre-bola.ts`, o rótulo vem do cadastro da organização). Só quem tem tarefa aparece; a soma é SEMPRE o número do cartão.
 */
export function detalheDosTerceiros(linhas: Array<LinhaParaKpi & { bolaCom?: string }>): string {
  const doCartao = linhas.filter((l) => situacaoDaTarefa(l) === 'cartorio')
  const por = new Map<string, number>()
  for (const l of doCartao) { const b = l.bolaCom && l.bolaCom !== BOLA_NOSSA ? l.bolaCom : 'Cartório'; por.set(b, (por.get(b) ?? 0) + 1) }
  return VALORES_DE_BOLA.filter((v) => por.has(v)).map((v) => `${v.toLowerCase()} ${milhar(por.get(v)!)}`).join(' · ')
}

/** Quantas famílias (processos distintos) têm tarefa sem responsável — o "14 famílias" do cartão. */
export function familiasSemResponsavel(linhas: LinhaParaKpi[]): number {
  return new Set(linhas.filter((l) => situacaoDaTarefa(l) === 'ninguem' && l.processoId != null).map((l) => l.processoId)).size
}

/** "certidões sem responsável · 14 famílias" — o subtítulo do cartão (singular quando é 1). */
export const subtituloSemResponsavel = (familias: number): string => `certidões sem responsável · ${plural(familias, 'família', 'famílias')}`

// ─── TENDÊNCIA: cor = bom ou ruim, não sobe ou desce ───────────────────────────────────────────────────────────────────────
/**
 * Regra do protótipo (inventário §2.2): a cor da tendência diz se a mudança é BOA ou RUIM. Alta de processos ativos é boa;
 * alta de atrasadas, de sem responsável, de aguardando terceiros e de cobranças é ruim. Volume de tarefas abertas e de trabalho
 * com a equipe não é bom nem ruim por si → neutra.
 */
export const SENTIDO_BOM: Partial<Record<ChaveKpi | 'processos', 'sobe' | 'desce'>> = {
  processos: 'sobe', ninguem: 'desce', cartorio: 'desce', venc: 'desce', cob: 'desce', risco: 'desce',
}
export type CorDaTendencia = 'boa' | 'ruim' | 'neutra'
export function corDaTendencia(chave: ChaveKpi | 'processos', direcao: 'up' | 'down' | 'igual'): CorDaTendencia {
  const bom = SENTIDO_BOM[chave]
  if (!bom || direcao === 'igual') return 'neutra'
  return (bom === 'sobe') === (direcao === 'up') ? 'boa' : 'ruim'
}

// ─── A FAIXA "HOJE" ─────────────────────────────────────────────────────────────────────────────────────────────────────────
export interface TrechoDaFrase { t: string; b?: boolean }

/** A ordem dos tipos de decisão na frase, com o singular e o plural exatos do protótipo. */
export const TIPOS_NA_FRASE: ReadonlyArray<{ tipo: string; um: string; varios: string }> = [
  { tipo: 'SEM_DONO', um: 'sem dono', varios: 'sem dono' },
  { tipo: 'FASE_DEIXADA', um: 'fase deixada', varios: 'fases deixadas' },
  { tipo: 'ESCALADA', um: 'escalada de cartório', varios: 'escaladas de cartório' },
  { tipo: 'DIVERGENCIA', um: 'divergência', varios: 'divergências' },
  { tipo: 'BLOQUEADA', um: 'bloqueada', varios: 'bloqueadas' },
  { tipo: 'CARGA', um: 'de carga da equipe', varios: 'de carga da equipe' },
]

/** Quantas decisões de cada tipo (o grain é o do item de "Precisa de você": a MESMA lista do selo da aba e do "Revisar o dia"). */
export function decisoesPorTipo(itens: Array<{ tipo: string }>): Record<string, number> {
  const r: Record<string, number> = {}
  for (const i of itens) r[i.tipo] = (r[i.tipo] ?? 0) + 1
  return r
}

/** "N decisões" / "1 decisão" — o rótulo do botão "Revisar o dia · N decisões". */
export const rotuloDecisoes = (n: number): string => (n === 1 ? '1 decisão' : `${milhar(n)} decisões`)

/**
 * A FRASE DO DIA, em trechos (os em negrito são `b`): "Hoje: 500 processos ativos, 453 andando no ritmo. 47 decisões precisam de você:
 * 14 sem dono, 11 fases deixadas, … O gargalo da semana é a fase Emissão documental (média 34 dias, meta 30), puxada por …".
 * Tudo calculado: processos e "no ritmo" da lista de processos (o ritmo = risco "ok", a MESMA palavra do Radar), decisões da lista de
 * "Precisa de você", gargalo do funil. Sem decisão, a frase diz isso; sem gargalo, não cita um.
 */
export function fraseDoDia(e: {
  processos: number; noRitmo: number; decisoes: Array<{ tipo: string }>; gargalo: LinhaDoFunil | null
}): TrechoDaFrase[] {
  const t: TrechoDaFrase[] = [
    { t: 'Hoje:', b: true },
    { t: ` ${plural(e.processos, 'processo ativo', 'processos ativos')}, ` },
    { t: `${milhar(e.noRitmo)} andando no ritmo`, b: true },
    { t: '. ' },
  ]
  const n = e.decisoes.length
  if (n === 0) t.push({ t: 'Nenhuma decisão precisa de você.' })
  else {
    const por = decisoesPorTipo(e.decisoes)
    const partes = TIPOS_NA_FRASE.filter((x) => por[x.tipo]).map((x) => `${milhar(por[x.tipo])} ${por[x.tipo] === 1 ? x.um : x.varios}`)
    t.push({ t: `${milhar(n)} ${n === 1 ? 'decisão precisa' : 'decisões precisam'} de você`, b: true })
    t.push({ t: partes.length ? `: ${partes.join(', ')}.` : '.' })
  }
  const g = e.gargalo
  if (g) {
    const det: string[] = []
    if (g.tempo && g.tempoTexto !== '—') det.push(`média ${g.tempoTexto}`)
    if (g.meta != null) det.push(`meta ${g.meta}`)
    if (!det.length && g.parados > 0) det.push(g.parados === 1 ? '1 parado' : `${g.parados} parados`)
    t.push({ t: ' O gargalo da semana é a fase ' }, { t: g.label, b: true })
    t.push({ t: `${det.length ? ` (${det.join(', ')})` : ''}${g.gargalo ? `, puxada por ${textoDoGargaloNaFrase(g.gargalo)}` : ''}.` })
  }
  return t
}

export const textoDaFrase = (trechos: TrechoDaFrase[]): string => trechos.map((x) => x.t).join('')

export function topoDaTorre(linhas: LinhaParaTopo[], processos: ProcessoParaTopo[], agora: Date, decisoes: Array<{ tipo: string }> = []): TopoDaTorre {
  const cartao = (chave: ChaveKpi): CartaoDoTopo => ({ chave, rotulo: KPI_POR_CHAVE[chave].rotulo, valor: numeroDoKpi(chave, linhas, agora), regra: KPI_POR_CHAVE[chave].regra })
  return {
    frase: textoDaFrase(fraseDoDia({ processos: processos.length, noRitmo: processos.filter((p) => p.risco === 'ok').length, decisoes, gargalo: null })),
    processosAtivos: { total: processos.length, distribuicao: distribuicaoPorPais(processos), emRisco: processos.filter(emRiscoCritico).length },
    situacao: CARTOES_DA_SITUACAO.map(cartao),
    agenda: CARTOES_DA_AGENDA.map(cartao),
  }
}
