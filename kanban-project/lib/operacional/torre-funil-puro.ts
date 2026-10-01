// lib/operacional/torre-funil-puro.ts
// ============================================================================
// FUNIL POR FASE DA VISÃO GERAL — Torre nova, frente B1 (01/10/2026). PURO: sem Prisma, importável pela tela, pela rota e pelo teste.
//
// UMA REGRA POR NÚMERO (cada coluna do protótipo, de onde vem):
//   · Processos           — os processos ATIVOS da Torre (a lista da aba Processos / Radar, já recortada pelo país) agrupados pela FASE ATUAL.
//   · Situação (barra)    — a MESMA palavra de risco do Radar e da aba Processos (`ProcessoDaTorre.risco`): ok → "no ritmo",
//                           atencao → "atenção", critico → "parados". Nenhuma regra de risco é recalculada aqui.
//   · Tempo médio         — média REAL das permanências CONCLUÍDAS (entrada → saída da fase, `PhaseAdvanceLog`): a MESMA conta de
//                           `tempoMedioRealPorFase` (metricas-processo.ts), só que repartida por país. Sem amostra → "—". Nunca estimativa.
//   · Meta                — cadastro de metas (padrão da fase ou do país). SÓ EXIBIÇÃO: não gera prazo nem entra no risco. Sem meta → "—".
//   · Maior gargalo       — o passo com mais tarefas PARADAS (aguardando terceiro/cliente ou bloqueadas) na fase; empate pelo mais antigo.
//   · "Gargalo da semana" — a fase que mais estourou a meta (média ÷ meta); sem nenhuma estourada, a fase com mais parados.
// O prazo NUNCA pausa por terceiro e a meta NUNCA vira prazo: este módulo só LÊ e apresenta.
// ============================================================================
import { nomeDoPasso } from './torre-filtros'
import { ehGrave, type NivelDeRisco } from './torre-risco'

/** Dias a partir dos quais uma espera já é "antiga" (o "há 30+ dias" do protótipo). */
export const LIMITE_ESPERA_ANTIGA_DIAS = 30
/** Sem meta cadastrada, uma média a partir daqui é mostrada em meses ("4,1 meses" do protótipo). */
export const DIAS_PARA_MOSTRAR_EM_MESES = 90

// ─── tempo médio real (a conta de `tempoMedioRealPorFase`, por país) ────────────────────────────────────────────────────
export interface LogDeFase { processoId: number; faseAtual: string; fasePretendida: string | null; criadoEm: Date }
export interface Permanencia { processoId: number; fase: string; dias: number }

/**
 * Cada permanência COMPLETA numa fase = o intervalo entre a linha que ENTROU nela (`fasePretendida = fase`) e a PRÓXIMA do mesmo processo
 * que SAIU dela (`faseAtual = fase`, cronologicamente depois). Fase ainda em curso (sem saída) não entra: só permanências completas.
 * É a MESMA regra de `tempoMedioRealPorFase` (provada por teste de paridade).
 */
export function permanenciasConcluidas(logs: LogDeFase[]): Permanencia[] {
  const porProcesso = new Map<number, LogDeFase[]>()
  for (const l of [...logs].sort((a, b) => a.processoId - b.processoId || a.criadoEm.getTime() - b.criadoEm.getTime())) {
    const lista = porProcesso.get(l.processoId) ?? []
    lista.push(l)
    porProcesso.set(l.processoId, lista)
  }
  const saida: Permanencia[] = []
  for (const [processoId, lista] of porProcesso) {
    for (const entrada of lista) {
      if (!entrada.fasePretendida) continue
      const sai = lista.find((l) => l.criadoEm > entrada.criadoEm && l.faseAtual === entrada.fasePretendida)
      if (!sai) continue
      saida.push({ processoId, fase: entrada.fasePretendida, dias: (sai.criadoEm.getTime() - entrada.criadoEm.getTime()) / 86_400_000 })
    }
  }
  return saida
}

export interface TempoDaFase { mediaDias: number; amostras: number }

/** A média por fase (1 casa decimal, como `tempoMedioRealPorFase`). Fase sem permanência concluída não aparece. */
export function tempoMedioPorFase(perm: Permanencia[]): Record<string, TempoDaFase> {
  const soma = new Map<string, { somaDias: number; amostras: number }>()
  for (const p of perm) {
    const a = soma.get(p.fase) ?? { somaDias: 0, amostras: 0 }
    soma.set(p.fase, { somaDias: a.somaDias + p.dias, amostras: a.amostras + 1 })
  }
  const r: Record<string, TempoDaFase> = {}
  for (const [fase, v] of soma) r[fase] = { mediaDias: Math.round((v.somaDias / v.amostras) * 10) / 10, amostras: v.amostras }
  return r
}

// ─── o que a rota entrega e a tela consome ──────────────────────────────────────────────────────────────────────────────
export interface FaseDoCadastro { key: string; label: string; condicional: boolean }
export interface SemanaDoFunil { processosAbertos: number; protocolados: number; tarefasAbertas: number; tarefasFechadas: number }
export interface DadosDoFunilPorEscopo {
  tempos: Record<string, TempoDaFase>
  /** Meta resolvida para o escopo (país → padrão da fase → `null`). */
  metas: Record<string, number | null>
  semana: SemanaDoFunil
}
export interface RespostaDoFunil {
  fases: FaseDoCadastro[]
  /** ISO da segunda-feira em que a semana começa (a mesma do "abre/fecha" de `tendenciasDaTorre`). */
  inicioDaSemana: string
  geral: DadosDoFunilPorEscopo
  /** Por RÓTULO do país (`CatalogoPais.countryLabel`, o mesmo que a linha e o processo carregam). */
  porPais: Record<string, DadosDoFunilPorEscopo>
}
export const ESCOPO_VAZIO: DadosDoFunilPorEscopo = { tempos: {}, metas: {}, semana: { processosAbertos: 0, protocolados: 0, tarefasAbertas: 0, tarefasFechadas: 0 } }

// ─── gargalo por fase ───────────────────────────────────────────────────────────────────────────────────────────────────
export interface LinhaParaGargalo {
  faseMacroKey: string | null
  estadoOperacao: 'FILA' | 'AGUARDANDO' | 'CONCLUIDA'
  statusTarefa: string
  esperandoHaDias: number | null
  passoCorrente?: { chave: string; label: string } | null
  etapaAtual?: string | null
}
export interface GargaloDaFase { passo: string; paradas: number; antigas: number }

/** Tarefa PARADA = esperando um terceiro (ou o cliente) ou bloqueada. É o que "empaca" a fase. */
export const tarefaParada = (l: Pick<LinhaParaGargalo, 'estadoOperacao' | 'statusTarefa'>): boolean =>
  l.estadoOperacao === 'AGUARDANDO' || l.statusTarefa === 'BLOQUEADA'

/** O passo com MAIS tarefas paradas na fase (empate: mais esperas antigas, depois o nome). `null` = nada parado. */
export function maiorGargalo(linhas: LinhaParaGargalo[], faseKey: string): GargaloDaFase | null {
  const por = new Map<string, GargaloDaFase>()
  for (const l of linhas) {
    if (l.faseMacroKey !== faseKey || !tarefaParada(l)) continue
    const passo = nomeDoPasso({ passoCorrente: l.passoCorrente ?? null, etapaAtual: l.etapaAtual ?? null }) ?? 'Sem passo definido'
    const g = por.get(passo) ?? { passo, paradas: 0, antigas: 0 }
    g.paradas++
    if (l.esperandoHaDias != null && l.esperandoHaDias >= LIMITE_ESPERA_ANTIGA_DIAS) g.antigas++
    por.set(passo, g)
  }
  return [...por.values()].sort((a, b) => b.paradas - a.paradas || b.antigas - a.antigas || a.passo.localeCompare(b.passo, 'pt-BR'))[0] ?? null
}

const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`

/** "12 tarefas em “Aguardando terceiros” · 5 há 30+ dias" — a coluna "Maior gargalo". */
export function textoDoGargalo(g: GargaloDaFase | null): string {
  if (!g) return '—'
  return `${plural(g.paradas, 'tarefa', 'tarefas')} em “${g.passo}”${g.antigas > 0 ? ` · ${g.antigas} há ${LIMITE_ESPERA_ANTIGA_DIAS}+ dias` : ''}`
}
/** A mesma informação para dentro da frase do dia: "12 tarefas em “Aguardando terceiros” (5 há mais de 30 dias)". */
export function textoDoGargaloNaFrase(g: GargaloDaFase): string {
  return `${plural(g.paradas, 'tarefa', 'tarefas')} em “${g.passo}”${g.antigas > 0 ? ` (${g.antigas} há mais de ${LIMITE_ESPERA_ANTIGA_DIAS} dias)` : ''}`
}

// ─── formatação ─────────────────────────────────────────────────────────────────────────────────────────────────────────
const decimalBR = (n: number) => String(n).replace('.', ',')

/** "12 dias" · "1 dia" · "menos de 1 dia" · "4,1 meses" (só sem meta e a partir de 90 dias) · "—" (sem amostra). */
export function textoDoTempoMedio(t: TempoDaFase | undefined, meta: number | null): string {
  if (!t || t.amostras === 0) return '—'
  if (meta == null && t.mediaDias >= DIAS_PARA_MOSTRAR_EM_MESES) return `${decimalBR(Math.round((t.mediaDias / 30) * 10) / 10)} meses`
  const d = Math.round(t.mediaDias)
  if (d < 1) return 'menos de 1 dia'
  return d === 1 ? '1 dia' : `${d} dias`
}
/** "15 dias" · "—" (sem meta cadastrada: nunca uma meta inventada). */
export const textoDaMeta = (meta: number | null): string => (meta == null ? '—' : meta === 1 ? '1 dia' : `${meta} dias`)
/** Estourou = há meta numérica e a média (como exibida, em dias inteiros) a ultrapassa — a conta do protótipo (`parseFloat(tempo) > metaN`). */
export const estourouAMeta = (t: TempoDaFase | undefined, meta: number | null): boolean =>
  !!t && t.amostras > 0 && meta != null && Math.round(t.mediaDias) > meta

// ─── a classe da barra: a MESMA palavra de risco do Radar e da aba Processos ───────────────────────────────────────────
export type ClasseDoFunil = 'ritmo' | 'atencao' | 'parado'
/**
 * A palavra de risco do processo → a cor da barra. A REGRA do risco mora em `torre-risco.ts` (dono: frente Radar + Processos) e chega
 * aqui no balde que o Radar usa (`ProcessoDaTorre.risco`: ok · atencao · critico) ou no nível completo (`NivelDeRisco`):
 * no ritmo → "no ritmo"; atenção → "atenção"; parado ou crítico (`ehGrave`) → "parado" — o mesmo vermelho do Radar ("Críticas").
 */
export function classeDoFunil(risco: string): ClasseDoFunil {
  const nivel: NivelDeRisco = risco === 'ok' ? 'no_ritmo' : (risco as NivelDeRisco)
  return nivel === 'no_ritmo' ? 'ritmo' : ehGrave(nivel) ? 'parado' : 'atencao'
}

// ─── o funil ────────────────────────────────────────────────────────────────────────────────────────────────────────────
export interface ProcessoParaFunil { faseAtual: { key: string | null }; risco: string }

export interface LinhaDoFunil {
  n: number
  key: string
  label: string
  condicional: boolean
  total: number
  ritmo: number
  atencao: number
  parados: number
  /** % de cada trecho da barra (1 casa decimal, como o protótipo). */
  pctRitmo: string
  pctAtencao: string
  pctParados: string
  tempo: TempoDaFase | undefined
  tempoTexto: string
  meta: number | null
  metaTexto: string
  estourou: boolean
  gargalo: GargaloDaFase | null
  gargaloTexto: string
}
export interface Funil { linhas: LinhaDoFunil[]; total: number; foraDoFunil: number }

const pct = (x: number, total: number) => (total > 0 ? `${((x / total) * 100).toFixed(1)}%` : '0.0%')

export function funilDasFases(args: {
  fases: FaseDoCadastro[]
  processos: ProcessoParaFunil[]
  linhas: LinhaParaGargalo[]
  escopo: DadosDoFunilPorEscopo
}): Funil {
  const { fases, processos, linhas, escopo } = args
  const chaves = new Set(fases.map((f) => f.key))
  const linhasDoFunil = fases.map((f, i): LinhaDoFunil => {
    const doFase = processos.filter((p) => p.faseAtual.key === f.key)
    const por = { ritmo: 0, atencao: 0, parado: 0 }
    for (const p of doFase) por[classeDoFunil(p.risco)]++
    const tempo = escopo.tempos[f.key]
    const meta = escopo.metas[f.key] ?? null
    const gargalo = maiorGargalo(linhas, f.key)
    return {
      n: i + 1, key: f.key, label: f.label, condicional: f.condicional, total: doFase.length,
      ritmo: por.ritmo, atencao: por.atencao, parados: por.parado,
      pctRitmo: pct(por.ritmo, doFase.length), pctAtencao: pct(por.atencao, doFase.length), pctParados: pct(por.parado, doFase.length),
      tempo, tempoTexto: textoDoTempoMedio(tempo, meta), meta, metaTexto: textoDaMeta(meta), estourou: estourouAMeta(tempo, meta),
      gargalo, gargaloTexto: textoDoGargalo(gargalo),
    }
  })
  const total = linhasDoFunil.reduce((s, l) => s + l.total, 0)
  return { linhas: linhasDoFunil, total, foraDoFunil: processos.filter((p) => !p.faseAtual.key || !chaves.has(p.faseAtual.key)).length }
}

/**
 * O GARGALO DA SEMANA (para a frase do dia): a fase cuja média mais ultrapassou a meta (média ÷ meta, só quem estourou);
 * se nenhuma estourou, a fase com mais processos parados; se nada está parado, `null` (a frase não cita gargalo).
 */
export function gargaloDaSemana(linhas: LinhaDoFunil[]): LinhaDoFunil | null {
  const estourou = linhas.filter((l) => l.estourou && l.tempo && l.meta)
    .sort((a, b) => b.tempo!.mediaDias / b.meta! - a.tempo!.mediaDias / a.meta! || b.parados - a.parados)
  if (estourou[0]) return estourou[0]
  return linhas.filter((l) => l.parados > 0).sort((a, b) => b.parados - a.parados || a.n - b.n)[0] ?? null
}

// ─── o resumo da semana ─────────────────────────────────────────────────────────────────────────────────────────────────
export type SentidoDoBacklog = 'cresce' | 'diminui' | 'estavel'
export const sentidoDoBacklog = (s: Pick<SemanaDoFunil, 'tarefasAbertas' | 'tarefasFechadas'>): SentidoDoBacklog =>
  s.tarefasAbertas > s.tarefasFechadas ? 'cresce' : s.tarefasAbertas < s.tarefasFechadas ? 'diminui' : 'estavel'

/** O link da linha: Processos naquela fase (`?aba=processos&fase=<chave>`), mantendo país e busca da URL. */
export function hrefDaFase(faseKey: string, manter: { pais?: string | null; q?: string | null } = {}): string {
  const q = new URLSearchParams()
  q.set('aba', 'processos'); q.set('fase', faseKey)
  if (manter.pais) q.set('pais', manter.pais)
  if (manter.q) q.set('q', manter.q)
  return `/torre?${q.toString()}`
}

/** O rótulo do país que está filtrando: o que os processos (ou, sem processo, as linhas) já recortados carregam. `null` = não dá para saber. */
export function rotuloDoPaisFiltrado(
  processos: Array<{ pais: string | null }> | null, linhas: Array<{ pais: string | null }>,
): string | null {
  return processos?.find((p) => p.pais)?.pais ?? linhas.find((l) => l.pais)?.pais ?? null
}

/** "etapa do processo (Genealogia → Protocolado)" — o intervalo vem das fases do cadastro (nunca literal); sem funil ainda, só a definição. */
export function textoDaFaseNasPalavras(linhas: Array<{ label: string }>): string {
  return linhas.length >= 2 ? `etapa do processo (${linhas[0].label} → ${linhas[linhas.length - 1].label})` : 'etapa do processo'
}
