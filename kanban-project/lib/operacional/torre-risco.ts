// lib/operacional/torre-risco.ts
// ============================================================================
// O RISCO DO PROCESSO NA TORRE — a REGRA ÚNICA (Torre nova, frente Radar + Processos, 01/10/2026).
//
// MÓDULO PURO: sem Prisma, sem relógio, importável pela tela e pelo servidor. Quem precisa dizer "este processo está no ritmo /
// em atenção / parado / crítico" (Radar, Processos por fase, Visão geral/funil, Processo/Foco) importa DAQUI e de nenhum outro
// lugar — assinatura estável: `riscoDoProcesso(entrada)` e `riscoDaCelula(estado, entrada)`.
//
// O protótipo NÃO tem função de risco (os rótulos estão digitados no dado). O que ele traz é TEXTO de regra — a legenda do Radar
// (inventário §2.1/§2.8):
//     atenção: "sem responsável, cobrança vencida, perto do prazo"
//     crítico: "atraso nosso + sem dono, divergência, parado 15+ dias"
// e o vocabulário em dois níveis de leitura: Radar (no ritmo · atenção · crítico) e Processos/funil (no ritmo · atenção · parado ·
// sem dono). Esta função reconstrói as regras de forma EXPLÍCITA, sobre dados reais, em quatro níveis ordenados.
//
// ─── OS QUATRO NÍVEIS (do mais leve ao mais grave) ──────────────────────────────────────────────────────────────────────────
//   no_ritmo  nada atrasado, sem dono, vencendo ou estourado.
//   atencao   qualquer UMA das condições abaixo (e nenhuma das mais graves):
//               A1  pontuação do "Precisa de você" ≥ 3 (sem responsável +3 · atrasada +4 · fase deixada +3 · divergência +3 ·
//                   bloqueada +2 · cobrança vencida +2 · 2+ cobranças sem resposta +2 — `precisa-de-voce.ts`);
//               A2  há cobrança/acompanhamento VENCIDO (legenda: "cobrança vencida") — mesmo sozinho (+2) não chegaria a 3;
//               A3  há tarefa aberta da fase com prazo HOJE ou AMANHÃ (legenda: "perto do prazo");
//               A4  o processo passou da META de tempo da fase (dias na fase > meta). SEM meta cadastrada esta condição NÃO
//                   existe: nenhum limiar é inventado. A meta é benchmark de exibição — não gera prazo nem altera tarefa.
//   parado    a bola está com TERCEIRO ou CLIENTE há 15+ dias E o acompanhamento está vencido (ninguém cobrou no prazo) —
//             é o "parado 15+ dias" da legenda, lido de registro real (`esperandoHaDias` + `acompanhamentoVencido`). Esperar
//             15 dias com a cobrança em dia NÃO é parado: é espera acompanhada (cai em A4, se passou da meta).
//   critico   pontuação do "Precisa de você" ≥ 6 (ex.: atraso nosso 4 + sem dono 3 = 7; fase deixada 3 + divergência 3 = 6).
// Vence o nível MAIS GRAVE; todos os motivos que se aplicam entram no texto (`motivos`), o mais grave primeiro.
//
// ─── COMO OS NÍVEIS APARECEM NAS TELAS ─────────────────────────────────────────────────────────────────────────────────────
//   • Radar (3 cores):            no ritmo · atenção · crítico  → `parado` e `critico` são "crítico" (mesmo balde vermelho);
//   • Processos/funil (4 pílulas): No ritmo · Atenção · Parado · Sem dono → `situacaoDaFase(nivel, semDono)`:
//        semDono → 'sd'; senão parado|critico → 'pa'; atencao → 'at'; no_ritmo → 'ok'.
//   • "Precisam de alguém" = qualquer nível ≠ no_ritmo. "Críticas"/"parados"/"em risco" = `ehGrave` (parado ou crítico).
// CONTINUIDADE: `critico` é exatamente o `CRITICO` (≥ 6) e `atencao` ⊇ `ATENCAO` (≥ 3) de `faixaDoScore` (precisa-de-voce.ts) —
// o teste `torre-nova-radar-risco` prova que os limiares daqui e de lá coincidem. O conjunto de processos "graves" que alimenta o
// cartão "em risco" da Visão geral e a foto diária é `criticoOuParado` desta mesma regra (ver `processosCriticos`).
// ============================================================================

export type NivelDeRisco = 'no_ritmo' | 'atencao' | 'parado' | 'critico'

/** Os limiares — constantes nomeadas, UM lugar. (3 e 6 espelham `faixaDoScore`; 15 é o "parado 15+ dias" da legenda.) */
export const LIMIAR_ATENCAO_SCORE = 3
export const LIMIAR_CRITICO_SCORE = 6
export const DIAS_PARADO = 15
/** "Perto do prazo": tarefa com prazo hoje (0) ou amanhã (1). */
export const DIAS_PERTO_DO_PRAZO = 1

/** Os sinais agregados do processo (todos opcionais: ausente = 0/false). Alimentam só o TEXTO do motivo e as regras A2/A3/parado. */
export interface SinaisDoProcesso {
  atrasadas?: number
  semResponsavel?: number
  acompanhamentoVencido?: number
  /** Alguma execução com 2+ cobranças sem resposta (escalada). */
  cobrancasSemResposta?: boolean
  /** Tarefa aberta de fase anterior à atual. */
  faseDeixada?: boolean
  /** Divergência passo × tarefa. */
  divergencia?: boolean
  bloqueadas?: number
  /** Tarefas abertas com prazo hoje ou amanhã (e ainda não atrasadas). */
  vencemEmBreve?: number
}

export interface EntradaDoRisco {
  /** Maior pontuação do "Precisa de você" entre os itens do processo (0 = nenhum item). */
  scoreMaximo: number
  /** Há trabalho aberto na fase atual e NENHUMA tarefa aberta tem responsável. */
  semDono: boolean
  /** Dias na fase atual — `null` = sem registro de entrada (a comparação com a meta não existe). */
  diasNaFase: number | null
  /** Meta de tempo da fase (benchmark de exibição) — `null` = sem meta cadastrada. */
  metaDias: number | null
  /** Há quantos dias a bola está com terceiro/cliente (maior espera); `null` = bola nossa ou sem registro. */
  bolaForaHaDias: number | null
  /** Rótulo da bola (Cartório, Cliente…), só para o texto do motivo. */
  bolaRotulo?: string | null
  sinais?: SinaisDoProcesso
}

export interface RiscoCalculado {
  nivel: NivelDeRisco
  /** O motivo legível (frase única, o mais grave primeiro). Nível `no_ritmo` também tem texto. */
  motivo: string
  /** Todos os motivos que se aplicam, do mais grave ao mais leve (vazio no ritmo). */
  motivos: string[]
  scoreMaximo: number
  semDono: boolean
  /** Dias na fase acima da meta (A4). `false` também quando não há meta ou registro. */
  passouDaMeta: boolean
}

/** Peso para ordenar "mais grave primeiro" no vocabulário completo (maior = mais grave). */
export const GRAVIDADE: Record<NivelDeRisco, number> = { no_ritmo: 0, atencao: 1, parado: 2, critico: 3 }
export const NIVEIS_DE_RISCO: readonly NivelDeRisco[] = ['no_ritmo', 'atencao', 'parado', 'critico']

const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`

/** `parado` ou `critico` — o balde "vermelho": "Críticas" do Radar, "parados" do funil, "em risco" da Visão geral. */
export const ehGrave = (n: NivelDeRisco): boolean => n === 'critico' || n === 'parado'
/** "Precisam de alguém": qualquer nível acima do ritmo. */
export const precisaDeAlguem = (n: NivelDeRisco): boolean => n !== 'no_ritmo'

/** Rótulo no vocabulário do RADAR (3 níveis): parado e crítico são "crítico". */
export const rotuloNoRadar = (n: NivelDeRisco): 'no ritmo' | 'atenção' | 'crítico' => (n === 'no_ritmo' ? 'no ritmo' : n === 'atencao' ? 'atenção' : 'crítico')
/** O balde do Radar/`ProcessoDaTorre.risco` ('ok' | 'atencao' | 'critico'). */
export const baldeDoRadar = (n: NivelDeRisco): 'ok' | 'atencao' | 'critico' => (n === 'no_ritmo' ? 'ok' : n === 'atencao' ? 'atencao' : 'critico')

/** A coluna "Situação" da aba Processos: ok · at · pa (Parado) · sd (Sem dono). Sem dono vence qualquer nível (como no protótipo). */
export type SituacaoDaFase = 'ok' | 'at' | 'pa' | 'sd'
export const situacaoDaFase = (n: NivelDeRisco, semDono: boolean): SituacaoDaFase => (semDono ? 'sd' : ehGrave(n) ? 'pa' : n === 'atencao' ? 'at' : 'ok')
export const ROTULO_DA_SITUACAO: Record<SituacaoDaFase, string> = { ok: 'No ritmo', at: 'Atenção', pa: 'Parado', sd: 'Sem dono' }
/** Ordem de "mais atrasado primeiro" (Processos): Parado → Sem dono → Atenção → No ritmo. */
export const PESO_DA_SITUACAO: Record<SituacaoDaFase, number> = { pa: 0, sd: 1, at: 2, ok: 3 }

/**
 * O RISCO DE UM PROCESSO (na fase em que está). Total e determinística: mesma entrada, mesma saída.
 * Ver o cabeçalho do arquivo para a regra por extenso.
 */
export function riscoDoProcesso(e: EntradaDoRisco): RiscoCalculado {
  const s = e.sinais ?? {}
  const score = Math.max(0, e.scoreMaximo || 0)
  const passouDaMeta = e.metaDias != null && e.metaDias > 0 && e.diasNaFase != null && e.diasNaFase > e.metaDias
  const parado = e.bolaForaHaDias != null && e.bolaForaHaDias >= DIAS_PARADO && (s.acompanhamentoVencido ?? 0) > 0

  const critico = score >= LIMIAR_CRITICO_SCORE
  const atencao = score >= LIMIAR_ATENCAO_SCORE || (s.acompanhamentoVencido ?? 0) > 0 || (s.vencemEmBreve ?? 0) > 0 || passouDaMeta

  const nivel: NivelDeRisco = critico ? 'critico' : parado ? 'parado' : atencao ? 'atencao' : 'no_ritmo'

  // Os motivos: do mais grave ao mais leve. Cada um só entra se o fato existe.
  const motivos: string[] = []
  if ((s.atrasadas ?? 0) > 0) motivos.push(`${plural(s.atrasadas!, 'tarefa atrasada', 'tarefas atrasadas')}`)
  if (s.faseDeixada) motivos.push('tarefa aberta de fase anterior')
  if (s.divergencia) motivos.push('divergência entre passo e tarefa')
  if (parado) motivos.push(`aguardando ${e.bolaRotulo ?? 'terceiro'} há ${e.bolaForaHaDias} d sem cobrança em dia`)
  if (e.semDono) motivos.push('sem responsável')
  else if ((s.semResponsavel ?? 0) > 0) motivos.push(`${plural(s.semResponsavel!, 'tarefa sem responsável', 'tarefas sem responsável')}`)
  if ((s.bloqueadas ?? 0) > 0) motivos.push(`${plural(s.bloqueadas!, 'tarefa bloqueada', 'tarefas bloqueadas')}`)
  if (s.cobrancasSemResposta) motivos.push('2+ cobranças sem resposta')
  if ((s.acompanhamentoVencido ?? 0) > 0 && !parado) motivos.push(`${plural(s.acompanhamentoVencido!, 'cobrança vencida', 'cobranças vencidas')}`)
  if ((s.vencemEmBreve ?? 0) > 0) motivos.push(`${plural(s.vencemEmBreve!, 'tarefa com prazo hoje ou amanhã', 'tarefas com prazo hoje ou amanhã')}`)
  if (passouDaMeta) motivos.push(`${e.diasNaFase} d na fase (meta ${e.metaDias} d)`)
  if (motivos.length === 0 && nivel !== 'no_ritmo') motivos.push(`pontuação ${score} no Precisa de você`)

  const prefixo = nivel === 'critico' ? 'Crítico' : nivel === 'parado' ? 'Parado' : nivel === 'atencao' ? 'Atenção' : 'No ritmo'
  const motivo = nivel === 'no_ritmo' ? 'No ritmo: nada atrasado, sem dono ou vencendo' : `${prefixo}: ${motivos.join(' · ')}`
  return { nivel, motivo, motivos, scoreMaximo: score, semDono: e.semDono, passouDaMeta }
}

/**
 * O RISCO DE UMA CÉLULA do Radar: só a célula da fase ATUAL tem risco (a do processo naquela fase); feita/futura/n-a não têm.
 */
export function riscoDaCelula(estado: 'feita' | 'atual' | 'futura' | 'na', entrada: EntradaDoRisco): RiscoCalculado | null {
  return estado === 'atual' ? riscoDoProcesso(entrada) : null
}

/** Ordenação "Mais grave primeiro" do Radar: balde vermelho (crítico/parado) → atenção → no ritmo (o protótipo tem 3 pesos). */
export const PESO_NO_RADAR: Record<NivelDeRisco, number> = { critico: 0, parado: 0, atencao: 1, no_ritmo: 2 }
