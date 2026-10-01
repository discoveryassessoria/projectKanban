// lib/operacional/torre-tarefas-tela.ts
// ============================================================================
// A ABA TAREFAS DA TORRE — as regras de TELA que o protótipo manda, em funções PURAS (sem Prisma, sem React, sem relógio:
// `agora` é sempre injetado e o dia é o dia operacional, America/Sao_Paulo). A tela só desenha o que sai daqui, e os testes
// provam daqui — uma conta só para o "Mostrando N de M", as contagens das visões, o resumo do grupo, o texto da bola e do
// "cobrar em", o passo da gaveta e as ações de cada linha.
//
// FONTE ÚNICA reaproveitada (nada recalculado): `PREDICADO_DO_KPI` (o mesmo dos cartões do topo), `nivelDeRisco`,
// `diasAtePrazo`, `torre-bola.ts` (bolaCom / bolaDesde / cobrarEm), `ROTULO_STATUS_TAREFA` e `textoPrazoDaTarefa`.
// ============================================================================
import { PREDICADO_DO_KPI, diasAtePrazo } from './torre-kpis'
import { diasEntreDiasOperacionais, FUSO_OPERACIONAL } from './tempo-operacional'
import type { BolaCom } from './torre-bola'
import { BOLA_NOSSA } from './torre-bola'
import { ROTULO_STATUS } from '@/src/lib/home/rotulo-status-tarefa'

// ─── AS VISÕES ──────────────────────────────────────────────────────────────
/** As oito visões do segmentado, na ordem do protótipo. */
export const VISOES_DA_TELA: ReadonlyArray<readonly [VisaoTarefas, string]> = [
  ['todas', 'Todas as abertas'], ['minhas', 'Minhas'], ['vencidas', 'Vencidas'], ['semdono', 'Sem responsável'],
  ['aguard', 'Aguardando terceiros'], ['cobranca', 'Cobrar hoje'], ['bloqueadas', 'Bloqueadas'], ['feito', 'Feito'],
]
export type VisaoTarefas = 'todas' | 'minhas' | 'vencidas' | 'semdono' | 'aguard' | 'cobranca' | 'bloqueadas' | 'feito' | 'acompvenc'
/**
 * Visões que a tela já não mostra no segmentado, mas que CONTINUAM válidas em `?visao=` e em visão salva antiga (nada é
 * apagado): "Acompanhamentos vencidos" (hoje é a visão "Cobrar hoje").
 */
export const VISOES_ESCONDIDAS: readonly VisaoTarefas[] = ['acompvenc']
export const CHAVES_DE_VISAO_DA_TELA: string[] = [...VISOES_DA_TELA.map(([v]) => v as string), ...VISOES_ESCONDIDAS]

/** A linha mínima que as visões leem. */
export interface LinhaParaVisao {
  dataPrazo: string | null
  responsavelId: number | null
  atrasada: boolean
  diasParaPrazo: number | null
  estadoOperacao: 'FILA' | 'AGUARDANDO' | 'CONCLUIDA'
  acompanhamentoVencido: boolean
  escalada: boolean
  faseMacroKey: string | null
  coluna: string
  cobravelVencida?: boolean
  processoId: number | null
  processoEmRisco?: boolean
}

/**
 * O PREDICADO de cada visão. "Vencidas", "Sem responsável" e "Aguardando terceiros" são os MESMOS predicados dos cartões do
 * topo (`torre-kpis.ts`) e "Cobrar hoje" é o MESMO "N a cobrar" da aba Terceiros — por isso os números fecham entre as telas.
 * "Bloqueadas" é o bloqueio de verdade (`coluna = BLOQUEADA`): espera de terceiro NÃO é bloqueio (é "Aguardando terceiros").
 */
export function predicadoDaVisao(v: VisaoTarefas, usuarioId: number | null, agora: Date): (l: LinhaParaVisao) => boolean {
  switch (v) {
    case 'vencidas': return (l) => PREDICADO_DO_KPI.venc!(l, agora)
    case 'semdono': return (l) => PREDICADO_DO_KPI.ninguem!(l, agora)
    case 'aguard': return (l) => PREDICADO_DO_KPI.cartorio!(l, agora)
    case 'cobranca': return (l) => l.cobravelVencida === true
    case 'acompvenc': return (l) => l.acompanhamentoVencido === true
    case 'minhas': return (l) => usuarioId != null && l.responsavelId === usuarioId
    case 'bloqueadas': return (l) => l.coluna === 'BLOQUEADA'
    default: return () => true
  }
}

/** O número de cada visão (sobre a lista de TRABALHO — sem as canceladas, que são só exibição). `feito` vem de outra leitura. */
export function contagemDaVisao(v: VisaoTarefas, linhas: LinhaParaVisao[], usuarioId: number | null, agora: Date): number {
  return linhas.filter(predicadoDaVisao(v, usuarioId, agora)).length
}

// ─── TEXTOS DA LINHA ────────────────────────────────────────────────────────
const diaMes = (iso: string): string => new Date(iso).toLocaleDateString('pt-BR', { timeZone: FUSO_OPERACIONAL, day: '2-digit', month: '2-digit' })

/** "dd/mm" no fuso operacional, ou `null` sem data. */
export const diaMesDe = (iso: string | null | undefined): string | null => {
  if (!iso) return null
  return Number.isNaN(new Date(iso).getTime()) ? null : diaMes(iso)
}

/** Há quantos DIAS CIVIS (operacionais) uma data ficou para trás; `null` sem data. Nunca negativo. */
export function haQuantosDias(iso: string | null | undefined, agora: Date): number | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return Math.max(0, -diasEntreDiasOperacionais(d, agora))
}

export interface LinhaParaBolaDaTela {
  bolaCom?: BolaCom
  bolaDesde?: string | null
  terceiroNome: string | null
  esperandoDe: 'terceiro' | 'cliente' | null
  estadoOperacao: 'FILA' | 'AGUARDANDO' | 'CONCLUIDA'
  responsavelNome?: string | null
}

/**
 * "Bola com" — "Nossa" · "Cliente · há 14 d" · "Cartório de Caxias do Sul · há 21 d". Com terceiro, o NOME do órgão da tarefa
 * (se tiver) ou o rótulo da categoria (Cartório, Tradutor, Juízo, Consulado). O "há N d" só existe quando há registro real do
 * início da espera (`bolaDesde`); sem registro, nada é inventado.
 */
export function textoDaBola(l: LinhaParaBolaDaTela, agora: Date): { nome: string; haDias: number | null; texto: string; comTerceiro: boolean } {
  const bola: BolaCom = l.bolaCom ?? (l.esperandoDe === 'cliente' ? 'Cliente' : l.esperandoDe === 'terceiro' || l.estadoOperacao === 'AGUARDANDO' ? 'Cartório' : BOLA_NOSSA)
  const comTerceiro = bola !== BOLA_NOSSA
  const nome = bola === 'Cliente' || !comTerceiro ? bola : l.terceiroNome ?? bola
  const haDias = comTerceiro ? haQuantosDias(l.bolaDesde, agora) : null
  return { nome, haDias, comTerceiro, texto: haDias != null ? `${nome} · há ${haDias} d` : nome }
}

export type TomDoCobrar = 'vermelho' | 'ambar' | 'cinza'
/**
 * "cobrar: ontem" (vermelho) · "cobrar: hoje" (âmbar) · "cobrar: amanhã" · "cobrar: 12/10" · "—". Vem de `cobrarEm` (o próximo
 * acompanhamento REGISTRADO ou o padrão de 7 dias — `cobrarEmPadrao`). Data anterior a ontem também é vermelha (venceu).
 */
export function textoDoCobrar(cobrarEm: string | null | undefined, agora: Date): { texto: string; tom: TomDoCobrar } | null {
  if (!cobrarEm) return null
  const d = new Date(cobrarEm)
  if (Number.isNaN(d.getTime())) return null
  const dias = diasEntreDiasOperacionais(d, agora)
  if (dias === -1) return { texto: 'cobrar: ontem', tom: 'vermelho' }
  if (dias < -1) return { texto: `cobrar: ${diaMes(cobrarEm)}`, tom: 'vermelho' }
  if (dias === 0) return { texto: 'cobrar: hoje', tom: 'ambar' }
  if (dias === 1) return { texto: 'cobrar: amanhã', tom: 'cinza' }
  return { texto: `cobrar: ${diaMes(cobrarEm)}`, tom: 'cinza' }
}

/** Coluna "Iniciou": "dd/mm" (registro real) · "não iniciou" (a tarefa ainda não foi iniciada) · "—" (registro antigo: nada é inventado). */
export function textoDoIniciou(l: { iniciouEm?: string | null; statusTarefa: string }): string {
  const dia = diaMesDe(l.iniciouEm)
  if (dia) return dia
  return l.statusTarefa === 'NAO_INICIADA' ? 'não iniciou' : '—'
}

// ─── O FILTRO "INICIOU" (campo `iniciouEm`) ─────────────────────────────────
export const INICIOU_TORRE = ['hoje', 'semana', '30dias', 'nao'] as const
export type IniciouTorre = (typeof INICIOU_TORRE)[number]
export const ROTULO_INICIOU_TORRE: Record<IniciouTorre, string> = {
  hoje: 'Hoje', semana: 'Esta semana', '30dias': 'Há mais de 30 dias', nao: 'Ainda não iniciou',
}

export interface FiltroDeIniciou { iniciou: IniciouTorre | null; iniciouDe: string | null; iniciouAte: string | null }

const diaYMD = (iso: string): string | null => {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? null : new Intl.DateTimeFormat('en-CA', { timeZone: FUSO_OPERACIONAL, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
}

/**
 * "Iniciou" — só considera quem TEM o registro (`iniciouEm`): registro antigo sem valor nunca casa "Hoje/Esta semana/Há mais
 * de 30 dias/Intervalo" (nada é inventado). "Ainda não iniciou" = a tarefa está NAO_INICIADA (estado real, não ausência de
 * registro). Semana = os últimos 7 dias operacionais (hoje incluído).
 */
export function casaIniciou(l: { iniciouEm?: string | null; statusTarefa: string }, f: FiltroDeIniciou, agora: Date): boolean {
  if (f.iniciou === 'nao') return l.statusTarefa === 'NAO_INICIADA'
  const temIntervalo = !!(f.iniciouDe || f.iniciouAte)
  if (!f.iniciou && !temIntervalo) return true
  if (!l.iniciouEm) return false
  const dia = diaYMD(l.iniciouEm)
  if (!dia) return false
  const dias = diasEntreDiasOperacionais(new Date(l.iniciouEm), agora) // 0 = hoje, −1 = ontem…
  if (f.iniciou === 'hoje' && dias !== 0) return false
  if (f.iniciou === 'semana' && !(dias <= 0 && dias >= -6)) return false
  if (f.iniciou === '30dias' && !(dias < -30)) return false
  if (f.iniciouDe && dia < f.iniciouDe) return false
  if (f.iniciouAte && dia > f.iniciouAte) return false
  return true
}

// ─── A GAVETA ───────────────────────────────────────────────────────────────
export interface PassoDaGaveta { n: number; nome: string; estado: 'feito' | 'agora' | 'adiante' }

/**
 * Os passos da gaveta: o estado de cada um vem do PASSO REAL da certidão (concluído = "feito"; o corrente = "agora"; os
 * demais, adiante). Sem passos materializados a lista é vazia (a tela diz "sem passos" — nunca os quatro nomes de exemplo).
 */
export function passosDaGaveta(etapas: Array<{ titulo: string; status: string; atual: boolean; ordem?: number }>): PassoDaGaveta[] {
  const ord = [...etapas].sort((a, b) => (a.ordem ?? 0) - (b.ordem ?? 0))
  // Concluído de verdade = CONCLUIDO (ou aprovado/executado já aceito). Cancelado/falhou não é "feito".
  const concluido = (s: string) => s === 'CONCLUIDO'
  const fora = (s: string) => s === 'CANCELADO'
  const marcado = ord.findIndex((e) => e.atual)
  // O "agora" é o passo corrente da tarefa; se ela não aponta nenhum, o primeiro que ainda não terminou.
  const agora = marcado >= 0 ? marcado : ord.findIndex((e) => !concluido(e.status) && !fora(e.status))
  return ord.map((e, i) => ({
    n: i + 1, nome: e.titulo,
    estado: concluido(e.status) ? 'feito' as const : i === agora ? 'agora' as const : 'adiante' as const,
  }))
}

// ─── O RESUMO DO GRUPO (cabeçalho da família) ───────────────────────────────
export interface ProcessoParaResumo {
  pais: string | null
  faseAtual: { label: string | null }
  /** O resumo das tarefas da FASE ATUAL (concluída ≠ cancelada): "X de Y prontas" = concluídas de (abertas + concluídas). */
  tarefasDaFase?: { abertas: number; concluidas: number; ehCertidao?: boolean }
  numeros: { vencidas: number; semResponsavel: number }
}

/**
 * "Espanha · Emissão documental · 3 de 14 prontas · 2 vencidas · 5 sem responsável". País e fase do PROCESSO; "X de Y
 * prontas" são as tarefas da fase atual já concluídas (a mesma conta da aba Processos); só aparecem "vencidas"/"sem responsável" quando > 0.
 * Sem o processo carregado, o resumo cai para o que as linhas sabem.
 */
export function resumoDoGrupo(p: ProcessoParaResumo | null, linhas: Array<{ pais: string | null; faseAtualDoProcessoLabel: string | null; atrasada: boolean; responsavelId: number | null }>): string {
  const partes: string[] = []
  const pais = p?.pais ?? linhas[0]?.pais ?? null
  const fase = p?.faseAtual.label ?? linhas[0]?.faseAtualDoProcessoLabel ?? null
  if (pais) partes.push(pais)
  if (fase) partes.push(fase)
  if (p?.tarefasDaFase) {
    const t = p.tarefasDaFase
    partes.push(`${t.concluidas} de ${t.abertas + t.concluidas} ${t.ehCertidao === false ? 'concluídas' : 'prontas'}`)
  }
  const vencidas = p ? p.numeros.vencidas : linhas.filter((l) => l.atrasada).length
  const semResp = p ? p.numeros.semResponsavel : linhas.filter((l) => l.responsavelId == null).length
  if (vencidas > 0) partes.push(`${vencidas} ${vencidas === 1 ? 'vencida' : 'vencidas'}`)
  if (semResp > 0) partes.push(`${semResp} sem responsável`)
  return partes.join(' · ')
}

// ─── O STATUS DA LINHA ──────────────────────────────────────────────────────
export type TomDoStatus = 'gry' | 'blu' | 'amb' | 'red' | 'can'
/**
 * O selo de status: o rótulo de `ROTULO_STATUS_TAREFA` (fonte única) e o tom — A iniciar (cinza) · Em andamento (azul) · Aguardando
 * (âmbar) · Bloqueada (vermelho) · Cancelada (tracejado). Uma tarefa que o motor bloqueou SÓ por esperar um terceiro
 * (`coluna = AGUARDANDO_TERCEIRO`) é "Aguardando", nunca "Bloqueada": o selo diz o que a tarefa É.
 */
export function statusDaLinha(l: { statusTarefa: string; coluna: string; esperandoDe: 'terceiro' | 'cliente' | null }): { texto: string; tom: TomDoStatus } {
  if (l.statusTarefa === 'CANCELADA') return { texto: ROTULO_STATUS.CANCELADA, tom: 'can' }
  const espera = l.coluna === 'AGUARDANDO_TERCEIRO' || l.statusTarefa === 'AGUARDANDO_TERCEIRO' || l.statusTarefa === 'AGUARDANDO_CLIENTE'
  if (espera) {
    const chave = l.statusTarefa === 'AGUARDANDO_CLIENTE' || l.esperandoDe === 'cliente' ? 'AGUARDANDO_CLIENTE' : 'AGUARDANDO_TERCEIRO'
    return { texto: ROTULO_STATUS[chave], tom: 'amb' }
  }
  const texto = ROTULO_STATUS[l.statusTarefa] ?? l.statusTarefa
  return { texto, tom: l.statusTarefa === 'BLOQUEADA' ? 'red' : l.statusTarefa === 'EM_ANDAMENTO' ? 'blu' : 'gry' }
}

// ─── AS AÇÕES DA LINHA (botão 1 e 2) ────────────────────────────────────────
export type AcaoDaLinha = 'Atribuir' | 'Iniciar' | 'Cobrar' | 'Cobrar cliente' | 'Adiar' | 'Desbloquear' | 'Conferir' | 'Continuar' | 'Abrir' | 'Ver motivo'

export interface LinhaParaAcao {
  statusTarefa: string
  coluna: string
  responsavelId: number | null
  esperandoDe: 'terceiro' | 'cliente' | null
  estadoOperacao: 'FILA' | 'AGUARDANDO' | 'CONCLUIDA'
  /** `aIniciar` da projeção, já corrigido por `aIniciarEfetivo`. */
  aIniciarEfetivo: boolean
  podeIniciar: boolean
  temAcompanhamento: boolean
  /** O rótulo de `acaoDe` (Operação): Iniciar · Conferir · Continuar · Abrir. */
  acaoPadrao: string
}

/**
 * Os DOIS botões da linha, por estado (o protótipo): cancelada → só "Ver motivo"; sem dono a iniciar → Atribuir · Iniciar;
 * esperando cartório → Cobrar · Adiar; esperando o cliente → Cobrar cliente · Desbloquear/Abrir; recebida a conferir →
 * Conferir · Abrir. O primeiro é o primário (marinho).
 */
export function acoesDaLinha(l: LinhaParaAcao): AcaoDaLinha[] {
  if (l.statusTarefa === 'CANCELADA') return ['Ver motivo']
  if (l.responsavelId == null) return ['Atribuir', l.aIniciarEfetivo && l.podeIniciar ? 'Iniciar' : 'Abrir']
  if (l.esperandoDe === 'cliente') return ['Cobrar cliente', l.coluna === 'BLOQUEADA' || l.statusTarefa === 'BLOQUEADA' ? 'Desbloquear' : 'Abrir']
  if (l.esperandoDe === 'terceiro' || l.estadoOperacao === 'AGUARDANDO') return ['Cobrar', l.temAcompanhamento ? 'Adiar' : 'Abrir']
  if (l.coluna === 'BLOQUEADA') return ['Desbloquear', 'Abrir']
  if (l.aIniciarEfetivo && l.podeIniciar) return ['Iniciar', 'Abrir']
  const padrao = (['Conferir', 'Continuar'] as string[]).includes(l.acaoPadrao) ? (l.acaoPadrao as AcaoDaLinha) : 'Abrir'
  return padrao === 'Abrir' ? ['Abrir'] : [padrao, 'Abrir']
}

// ─── AGRUPAR / ORDENAR PARA A TELA ──────────────────────────────────────────
export type Agrupar = 'fam' | 'resp' | 'fase' | 'org' | 'none'

export interface LinhaParaGrupo {
  taskId: number
  statusTarefa: string
  familiaNome: string | null
  processoNome: string | null
  responsavelNome: string | null
  faseAtualDoProcessoLabel: string | null
  faseMacroKey: string | null
  terceiroNome: string | null
}

/** A chave do grupo: família · responsável · fase · cartório · "Todas". */
export function chaveDoGrupo(l: LinhaParaGrupo, por: Agrupar): string {
  switch (por) {
    case 'resp': return l.responsavelNome ?? 'Sem responsável'
    case 'org': return l.terceiroNome ?? 'Sem cartório'
    case 'fase': return l.faseAtualDoProcessoLabel ?? l.faseMacroKey ?? 'Sem fase'
    case 'none': return 'Todas'
    default: return l.familiaNome ?? l.processoNome ?? 'Sem família'
  }
}

/**
 * Agrupa mantendo a ordem de primeira aparição dos grupos (a ordem padrão do servidor decide quem vem antes) e a CANCELADA no
 * FIM de cada grupo (riscada: continua visível, nunca esconde — mas não ocupa o lugar do trabalho).
 */
export function agruparParaTela<T extends LinhaParaGrupo>(linhas: T[], por: Agrupar): Array<[string, T[]]> {
  const m = new Map<string, T[]>()
  for (const l of linhas) { const k = chaveDoGrupo(l, por); (m.get(k) ?? m.set(k, []).get(k)!).push(l) }
  return [...m.entries()].map(([k, itens]) => [k, [...itens.filter((x) => x.statusTarefa !== 'CANCELADA'), ...itens.filter((x) => x.statusTarefa === 'CANCELADA')]] as [string, T[]])
}

/** Dias até o prazo (dia operacional), `null` sem prazo — reexporta a conta única para quem monta a tela. */
export const diasDoPrazo = diasAtePrazo

// ─── A VISÃO "FEITO" ────────────────────────────────────────────────────────
export type BlocoDoFeito = 'hoje' | 'ontem' | 'antes'
/** O "dia" da conclusão frente a `agora`, no dia operacional (America/Sao_Paulo). */
export function blocoDoFeito(concluidaEm: string | null | undefined, agora: Date): BlocoDoFeito | null {
  if (!concluidaEm) return null
  const d = new Date(concluidaEm)
  if (Number.isNaN(d.getTime())) return null
  const dias = diasEntreDiasOperacionais(d, agora)
  return dias === 0 ? 'hoje' : dias === -1 ? 'ontem' : 'antes'
}

const horaMin = (iso: string): string => new Date(iso).toLocaleTimeString('pt-BR', { timeZone: FUSO_OPERACIONAL, hour: '2-digit', minute: '2-digit', hour12: false })

/** "hoje 16:40" · "ontem 17:20" · "27/09" (a partir de antes de ontem só o dia). */
export function textoConcluidaEm(concluidaEm: string | null | undefined, agora: Date): string {
  const b = blocoDoFeito(concluidaEm, agora)
  if (!b || !concluidaEm) return '—'
  return b === 'hoje' ? `hoje ${horaMin(concluidaEm)}` : b === 'ontem' ? `ontem ${horaMin(concluidaEm)}` : diaMes(concluidaEm)
}

/** "Prazo era": o dia do prazo da tarefa e se foi CUMPRIDO (concluída até o dia do prazo) — verde; depois do prazo — vermelho. */
export function prazoEraDoFeito(dataPrazo: string | null | undefined, concluidaEm: string | null | undefined): { texto: string; cumprido: boolean | null } {
  const texto = diaMesDe(dataPrazo) ?? '—'
  if (!dataPrazo || !concluidaEm) return { texto, cumprido: null }
  const prazo = diaYMD(dataPrazo), fim = diaYMD(concluidaEm)
  if (!prazo || !fim) return { texto, cumprido: null }
  return { texto, cumprido: fim <= prazo }
}

/** As páginas da tabela: grupos INTEIROS até `porPagina` linhas (um grupo nunca é partido; um grupo maior que a página ocupa uma sozinho). */
export function paginarGrupos<T>(grupos: Array<[string, T[]]>, porPagina: number): Array<Array<[string, T[]]>> {
  const paginas: Array<Array<[string, T[]]>> = []
  let atual: Array<[string, T[]]> = []
  let n = 0
  for (const g of grupos) {
    if (atual.length > 0 && n + g[1].length > porPagina) { paginas.push(atual); atual = []; n = 0 }
    atual.push(g); n += g[1].length
  }
  if (atual.length > 0) paginas.push(atual)
  return paginas
}
