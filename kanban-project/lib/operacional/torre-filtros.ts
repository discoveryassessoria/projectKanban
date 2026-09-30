// lib/operacional/torre-filtros.ts
// ============================================================================
// OS FILTROS DA ABA TAREFAS DA TORRE — Seção 3 (30/09/2026). PURO: sem Prisma, importável pela tela, pela rota das
// visões salvas e pelos testes. `agora` é SEMPRE injetável; o "dia" é o dia operacional (America/Sao_Paulo).
//
// UMA FUNÇÃO POR PERGUNTA, UMA SÓ COMPOSIÇÃO:
//   · AND entre filtros diferentes; OR dentro de um filtro de vários valores;
//   · `filtrarLinhas` é a ÚNICA porta: o "Mostrando N de M", os contadores dos chips de prazo e a lista que a tabela
//     desenha saem da MESMA chamada (nunca uma segunda conta);
//   · o estado dos filtros é serializável (URL `?resp=…&prazo=…` e spec da visão salva): `normalizarFiltros` é o ÚNICO
//     validador — valor fora da lista fechada é descartado; a visão guarda a PERGUNTA, nunca o resultado.
//
// CAMPO DE ORIGEM de cada filtro (todos já existem em LinhaTorre; nada foi inventado):
//   responsável → responsavelId · prazo → dataPrazo · quando → criadaEm / atribuidaEm · família → familiaNome (processoNome)
//   status → statusTarefa · tipo de certidão → categoriaDoc · fase → faseMacroKey · passo → passoCorrente.label (etapaAtual)
//   cartório → orgaoId (terceiroNome) · prioridade → prioridade · risco → o MESMO nível da coluna Risco (`nivelDeRisco`)
//   linha reta → linhaReta · acompanhamento → acompanhamentoVencido + acompanhamentoPasso · cobrança → cobravelVencida / escalada.
// "Iniciada" (Quando) NÃO existe: `Tarefa.dataInicio` não é confiável (tarefa concluída sem nunca ter sido "iniciada" fica com
// `dataInicio` nulo — medido em produção, 26 concluídas e 0 com `dataInicio`) e a linha nem o carrega.
// ============================================================================
import { diasAtePrazo } from './torre-kpis'
import { diaOperacional } from './tempo-operacional'
import { ehCobravelVencido } from './torre-predicados'
import { ROTULO_STATUS } from '@/src/lib/home/rotulo-status-tarefa'

// ─── listas fechadas ────────────────────────────────────────────────────────
export const PRAZOS_TORRE = ['vencidas', 'hoje', 'amanha', '7dias', '30dias', 'sem'] as const
export const QUANDOS_TORRE = ['criada', 'atribuida'] as const
export const CERTIDOES_TORRE = ['NASCIMENTO', 'CASAMENTO', 'OBITO', 'OUTRO'] as const
export const PRIORIDADES_TORRE = ['URGENTE', 'ALTA', 'MEDIA', 'BAIXA'] as const
export const RISCOS_TORRE = ['critico', 'atencao', 'ritmo'] as const
export const ACOMPS_TORRE = ['vencido', '3dias', 'sem'] as const
export const COBRANCAS_TORRE = ['vencida', 'semresposta'] as const
export const ORDENS_TORRE = ['prazo', 'risco', 'familia', 'responsavel', 'criacao'] as const
export const STATUS_TORRE: readonly string[] = Object.keys(ROTULO_STATUS)

export type PrazoTorre = (typeof PRAZOS_TORRE)[number]
export type QuandoTorre = (typeof QUANDOS_TORRE)[number]
export type RiscoTorre = (typeof RISCOS_TORRE)[number]
export type AcompTorre = (typeof ACOMPS_TORRE)[number]
export type CobrancaTorre = (typeof COBRANCAS_TORRE)[number]
export type OrdemTorre = (typeof ORDENS_TORRE)[number]

export const ROTULO_PRAZO_TORRE: Record<PrazoTorre, string> = {
  vencidas: 'Vencidas', hoje: 'Hoje', amanha: 'Amanhã', '7dias': '7 dias', '30dias': '30 dias', sem: 'Sem prazo',
}
export const ROTULO_QUANDO_TORRE: Record<QuandoTorre, string> = { criada: 'Criada', atribuida: 'Atribuída' }
export const ROTULO_CERTIDAO_TORRE: Record<string, string> = { NASCIMENTO: 'Nascimento', CASAMENTO: 'Casamento', OBITO: 'Óbito', OUTRO: 'Outro documento' }
export const ROTULO_PRIORIDADE_TORRE: Record<string, string> = { URGENTE: 'Urgente', ALTA: 'Alta', MEDIA: 'Média', BAIXA: 'Baixa' }
export const ROTULO_RISCO_TORRE: Record<RiscoTorre, string> = { critico: 'Crítico', atencao: 'Atenção', ritmo: 'No ritmo' }
export const ROTULO_ACOMP_TORRE: Record<AcompTorre, string> = { vencido: 'Vencido', '3dias': 'Vence em até 3 dias', sem: 'Sem acompanhamento' }
export const ROTULO_COBRANCA_TORRE: Record<CobrancaTorre, string> = { vencida: 'Cobrança vencida', semresposta: 'Cobrança sem resposta (escalada)' }
export const ROTULO_ORDEM_TORRE: Record<OrdemTorre, string> = {
  prazo: 'Prazo', risco: 'Risco', familia: 'Família', responsavel: 'Responsável', criacao: 'Criação (mais recentes primeiro)',
}

// ─── o estado ───────────────────────────────────────────────────────────────
export interface FiltrosTorre {
  /** `'eu'` · `'sem'` (sem responsável) · id numérico (texto). */
  responsavel: string[]
  prazo: PrazoTorre[]
  /** Intervalo de prazo, `AAAA-MM-DD` (dia operacional, inclusivo nas duas pontas). Restringe além dos chips e exclui "sem prazo". */
  prazoDe: string | null
  prazoAte: string | null
  quando: QuandoTorre | null
  quandoDe: string | null
  quandoAte: string | null
  /** Texto (sem acento, sem caixa) contido no nome da família. */
  familia: string | null
  status: string[]
  certidao: string[]
  /** `faseMacroKey`. */
  fase: string[]
  /** Nome do passo atual (o rótulo do cadastro). */
  passo: string[]
  /** `'sem'` (sem cartório) · id numérico (texto) do órgão. */
  orgao: string[]
  prioridade: string[]
  risco: RiscoTorre[]
  linhaReta: boolean
  acomp: AcompTorre[]
  cobranca: CobrancaTorre[]
  /** `null` = a ordem que o servidor entregou. */
  ordenar: OrdemTorre | null
}

export const FILTROS_VAZIOS: Readonly<FiltrosTorre> = Object.freeze({
  responsavel: [], prazo: [], prazoDe: null, prazoAte: null, quando: null, quandoDe: null, quandoAte: null, familia: null,
  status: [], certidao: [], fase: [], passo: [], orgao: [], prioridade: [], risco: [], linhaReta: false, acomp: [], cobranca: [], ordenar: null,
})
export const filtrosVazios = (): FiltrosTorre => ({
  responsavel: [], prazo: [], prazoDe: null, prazoAte: null, quando: null, quandoDe: null, quandoAte: null, familia: null,
  status: [], certidao: [], fase: [], passo: [], orgao: [], prioridade: [], risco: [], linhaReta: false, acomp: [], cobranca: [], ordenar: null,
})

// ─── a linha (subconjunto de LinhaTorre) ────────────────────────────────────
export interface LinhaParaFiltro {
  responsavelId: number | null
  responsavelNome?: string | null
  dataPrazo: string | null
  criadaEm: string | null
  atribuidaEm: string | null
  familiaNome: string | null
  processoNome: string | null
  statusTarefa: string
  categoriaDoc: 'NASCIMENTO' | 'CASAMENTO' | 'OBITO' | null
  faseMacroKey: string | null
  passoCorrente: { chave: string; label: string } | null
  etapaAtual: string | null
  orgaoId?: number | null
  terceiroNome: string | null
  prioridade: string
  atrasada: boolean
  escalada: boolean
  emRisco: boolean
  acompanhamentoVencido: boolean
  acompanhamentoPasso: { dueAt: string | null; semPrazo: boolean } | null
  cobravelVencida?: boolean
  estadoOperacao: 'FILA' | 'AGUARDANDO' | 'CONCLUIDA'
  linhaReta: boolean | null
}

export interface ContextoDeFiltro { usuarioId: number | null; agora: Date }

// ─── normalização (o ÚNICO validador — URL e visão salva passam por aqui) ───
const MAX_LISTA = 30
const semAcento = (x: string | null | undefined): string => String(x ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim()

function listaFechada<T extends string>(v: unknown, permitidos: readonly string[]): T[] {
  const itens = Array.isArray(v) ? v : typeof v === 'string' ? v.split(',') : []
  const fora = new Set<string>()
  for (const i of itens) { const s = String(i).trim(); if (permitidos.includes(s)) fora.add(s) }
  return [...fora].slice(0, MAX_LISTA) as T[]
}
function listaPorFormato(v: unknown, ok: (s: string) => boolean, max = 80): string[] {
  const itens = Array.isArray(v) ? v : typeof v === 'string' ? (v === '' ? [] : v.split(',')) : []
  const s = new Set<string>()
  for (const i of itens) { const t = String(i).trim(); if (t && t.length <= max && ok(t)) s.add(t) }
  return [...s].slice(0, MAX_LISTA)
}
/** `AAAA-MM-DD` de um dia que EXISTE no calendário; senão `null`. */
function diaValido(v: unknown): string | null {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null
  const d = new Date(`${v}T00:00:00.000Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v ? v : null
}

/** Qualquer objeto (corpo de POST, spec salva, query já desmembrada) → filtros válidos. Valor fora da lista é DESCARTADO. */
export function normalizarFiltros(b: Record<string, unknown> | null | undefined): FiltrosTorre {
  const x = b ?? {}
  const quando = typeof x.quando === 'string' && (QUANDOS_TORRE as readonly string[]).includes(x.quando) ? (x.quando as QuandoTorre) : null
  const ordenar = typeof x.ordenar === 'string' && (ORDENS_TORRE as readonly string[]).includes(x.ordenar) ? (x.ordenar as OrdemTorre) : null
  const familia = typeof x.familia === 'string' && x.familia.trim() ? x.familia.trim().slice(0, 80) : null
  const lr = x.linhaReta
  return {
    responsavel: listaPorFormato(x.responsavel, (s) => s === 'eu' || s === 'sem' || /^[1-9]\d{0,9}$/.test(s)),
    prazo: listaFechada<PrazoTorre>(x.prazo, PRAZOS_TORRE),
    prazoDe: diaValido(x.prazoDe), prazoAte: diaValido(x.prazoAte),
    quando, quandoDe: quando ? diaValido(x.quandoDe) : null, quandoAte: quando ? diaValido(x.quandoAte) : null,
    familia,
    status: listaFechada<string>(x.status, STATUS_TORRE),
    certidao: listaFechada<string>(x.certidao, CERTIDOES_TORRE),
    fase: listaPorFormato(x.fase, (s) => /^[A-Za-z0-9_.-]{1,60}$/.test(s), 60),
    passo: listaPorFormato(x.passo, () => true, 80),
    orgao: listaPorFormato(x.orgao, (s) => s === 'sem' || /^[1-9]\d{0,9}$/.test(s)),
    prioridade: listaFechada<string>(x.prioridade, PRIORIDADES_TORRE),
    risco: listaFechada<RiscoTorre>(x.risco, RISCOS_TORRE),
    linhaReta: lr === true || lr === 'true' || lr === '1',
    acomp: listaFechada<AcompTorre>(x.acomp, ACOMPS_TORRE),
    cobranca: listaFechada<CobrancaTorre>(x.cobranca, COBRANCAS_TORRE),
    ordenar,
  }
}

// ─── URL ↔ estado (idempotente: serializar(ler(serializar(f))) === serializar(f)) ─
/** As chaves da querystring que pertencem aos filtros (a Torre só mexe nestas ao escrever a URL). */
export const CHAVES_URL_FILTROS = [
  'resp', 'prazo', 'prazo_de', 'prazo_ate', 'quando', 'quando_de', 'quando_ate', 'familia', 'status', 'certidao', 'fase', 'passo',
  'orgao', 'prio', 'risco', 'linha_reta', 'acomp', 'cobranca', 'ordem',
] as const

/** Filtros → pares `[chave, valor]` (só o que está ativo, em ordem fixa). */
export function filtrosParaPares(f: FiltrosTorre): Array<[string, string]> {
  const n = normalizarFiltros(f as unknown as Record<string, unknown>)
  const p: Array<[string, string]> = []
  const lista = (k: string, v: string[]) => { if (v.length) p.push([k, v.join(',')]) }
  lista('resp', n.responsavel); lista('prazo', n.prazo)
  if (n.prazoDe) p.push(['prazo_de', n.prazoDe])
  if (n.prazoAte) p.push(['prazo_ate', n.prazoAte])
  if (n.quando) p.push(['quando', n.quando])
  if (n.quandoDe) p.push(['quando_de', n.quandoDe])
  if (n.quandoAte) p.push(['quando_ate', n.quandoAte])
  if (n.familia) p.push(['familia', n.familia])
  lista('status', n.status); lista('certidao', n.certidao); lista('fase', n.fase)
  // O nome do passo pode ter vírgula: nunca vai na lista por vírgula — uma chave repetida por valor.
  for (const v of n.passo) p.push(['passo', v])
  lista('orgao', n.orgao); lista('prio', n.prioridade); lista('risco', n.risco)
  if (n.linhaReta) p.push(['linha_reta', '1'])
  lista('acomp', n.acomp); lista('cobranca', n.cobranca)
  if (n.ordenar) p.push(['ordem', n.ordenar])
  return p
}

/** Aplica os filtros a uma querystring: remove as chaves dos filtros e escreve as ativas. Não toca em nenhuma outra chave. */
export function aplicarFiltrosNaQuery(query: URLSearchParams, f: FiltrosTorre): URLSearchParams {
  const q = new URLSearchParams(query.toString())
  for (const k of CHAVES_URL_FILTROS) q.delete(k)
  for (const [k, v] of filtrosParaPares(f)) q.append(k, v)
  return q
}

/** Querystring → filtros (valor inválido é descartado). */
export function filtrosDaQuery(query: URLSearchParams): FiltrosTorre {
  const g = (k: string) => query.get(k) ?? undefined
  return normalizarFiltros({
    responsavel: g('resp'), prazo: g('prazo'), prazoDe: g('prazo_de'), prazoAte: g('prazo_ate'),
    quando: g('quando'), quandoDe: g('quando_de'), quandoAte: g('quando_ate'), familia: g('familia'),
    status: g('status'), certidao: g('certidao'), fase: g('fase'), passo: query.getAll('passo'), orgao: g('orgao'),
    prioridade: g('prio'), risco: g('risco'), linhaReta: g('linha_reta'), acomp: g('acomp'), cobranca: g('cobranca'), ordenar: g('ordem'),
  })
}

export const filtrosIguais = (a: FiltrosTorre, b: FiltrosTorre): boolean => JSON.stringify(filtrosParaPares(a)) === JSON.stringify(filtrosParaPares(b))

// ─── cada filtro é um predicado PURO ────────────────────────────────────────
const diaDe = (iso: string | null): string | null => {
  if (!iso) return null
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? null : diaOperacional(d)
}
const dentroDoIntervalo = (dia: string | null, de: string | null, ate: string | null): boolean =>
  dia != null && (de == null || dia >= de) && (ate == null || dia <= ate)

/** O NÍVEL de risco da linha — a MESMA regra da coluna Risco (`riscoDe`, tipos.ts lê daqui). */
export function nivelDeRisco(l: Pick<LinhaParaFiltro, 'atrasada' | 'escalada' | 'emRisco' | 'acompanhamentoVencido' | 'statusTarefa'>): RiscoTorre {
  if (l.atrasada || l.escalada) return 'critico'
  if (l.emRisco || l.acompanhamentoVencido || l.statusTarefa === 'BLOQUEADA') return 'atencao'
  return 'ritmo'
}

export const nomeDoPasso = (l: Pick<LinhaParaFiltro, 'passoCorrente' | 'etapaAtual'>): string | null => l.passoCorrente?.label ?? l.etapaAtual ?? null

export function casaResponsavel(l: Pick<LinhaParaFiltro, 'responsavelId'>, vals: string[], usuarioId: number | null): boolean {
  if (!vals.length) return true
  return vals.some((v) => v === 'sem' ? l.responsavelId == null : v === 'eu' ? usuarioId != null && l.responsavelId === usuarioId : l.responsavelId != null && String(l.responsavelId) === v)
}

/** Prazo: OR entre os chips; o intervalo restringe por cima (AND) e exclui quem não tem prazo. Dia operacional. */
export function casaPrazo(l: Pick<LinhaParaFiltro, 'dataPrazo'>, f: Pick<FiltrosTorre, 'prazo' | 'prazoDe' | 'prazoAte'>, agora: Date): boolean {
  const d = diasAtePrazo(l, agora)
  if (f.prazo.length) {
    const ok = f.prazo.some((p) => {
      if (p === 'sem') return l.dataPrazo == null
      if (d == null) return false
      switch (p) {
        case 'vencidas': return d < 0
        case 'hoje': return d === 0
        case 'amanha': return d === 1
        case '7dias': return d >= 0 && d <= 7
        case '30dias': return d >= 0 && d <= 30
      }
    })
    if (!ok) return false
  }
  if (f.prazoDe || f.prazoAte) return dentroDoIntervalo(diaDe(l.dataPrazo), f.prazoDe, f.prazoAte)
  return true
}

/** Quando: só restringe com ao menos uma ponta de intervalo; o campo vazio nunca casa. */
export function casaQuando(l: Pick<LinhaParaFiltro, 'criadaEm' | 'atribuidaEm'>, f: Pick<FiltrosTorre, 'quando' | 'quandoDe' | 'quandoAte'>): boolean {
  if (!f.quando || (!f.quandoDe && !f.quandoAte)) return true
  return dentroDoIntervalo(diaDe(f.quando === 'criada' ? l.criadaEm : l.atribuidaEm), f.quandoDe, f.quandoAte)
}

export const casaFamilia = (l: Pick<LinhaParaFiltro, 'familiaNome' | 'processoNome'>, texto: string | null): boolean =>
  !texto || semAcento(l.familiaNome ?? l.processoNome).includes(semAcento(texto))

export const casaCertidao = (l: Pick<LinhaParaFiltro, 'categoriaDoc'>, vals: string[]): boolean => !vals.length || vals.includes(l.categoriaDoc ?? 'OUTRO')

export function casaOrgao(l: Pick<LinhaParaFiltro, 'orgaoId' | 'terceiroNome'>, vals: string[]): boolean {
  if (!vals.length) return true
  return vals.some((v) => v === 'sem' ? l.orgaoId == null && !l.terceiroNome : l.orgaoId != null && String(l.orgaoId) === v)
}

export function casaAcomp(l: Pick<LinhaParaFiltro, 'acompanhamentoVencido' | 'acompanhamentoPasso'>, vals: AcompTorre[], agora: Date): boolean {
  if (!vals.length) return true
  const a = l.acompanhamentoPasso
  const temData = !!a && !a.semPrazo && !!a.dueAt
  return vals.some((v) => {
    if (v === 'vencido') return l.acompanhamentoVencido === true
    if (v === 'sem') return !temData
    // "3 dias": ainda NÃO venceu (vencido é outra opção) e cai de hoje a 3 dias à frente.
    const d = temData ? diasAtePrazo({ dataPrazo: a!.dueAt }, agora) : null
    return !l.acompanhamentoVencido && d != null && d >= 0 && d <= 3
  })
}

export function casaCobranca(l: Pick<LinhaParaFiltro, 'cobravelVencida' | 'acompanhamentoVencido' | 'faseMacroKey' | 'estadoOperacao' | 'escalada'>, vals: CobrancaTorre[]): boolean {
  if (!vals.length) return true
  return vals.some((v) => v === 'vencida' ? (l.cobravelVencida ?? ehCobravelVencido(l)) === true : l.escalada === true)
}

/** TODOS os filtros, em AND. A única porta para saber "esta linha passa?". */
export function linhaPassa(l: LinhaParaFiltro, f: FiltrosTorre, ctx: ContextoDeFiltro): boolean {
  return casaResponsavel(l, f.responsavel, ctx.usuarioId)
    && casaPrazo(l, f, ctx.agora)
    && casaQuando(l, f)
    && casaFamilia(l, f.familia)
    && (!f.status.length || f.status.includes(l.statusTarefa))
    && casaCertidao(l, f.certidao)
    && (!f.fase.length || (l.faseMacroKey != null && f.fase.includes(l.faseMacroKey)))
    && (!f.passo.length || (nomeDoPasso(l) != null && f.passo.includes(nomeDoPasso(l) as string)))
    && casaOrgao(l, f.orgao)
    && (!f.prioridade.length || f.prioridade.includes(l.prioridade))
    && (!f.risco.length || f.risco.includes(nivelDeRisco(l)))
    && (!f.linhaReta || l.linhaReta === true)
    && casaAcomp(l, f.acomp, ctx.agora)
    && casaCobranca(l, f.cobranca)
}

// ─── ordenação ──────────────────────────────────────────────────────────────
const RANK_RISCO: Record<RiscoTorre, number> = { critico: 0, atencao: 1, ritmo: 2 }
const tempo = (iso: string | null): number => { const t = iso ? Date.parse(iso) : NaN; return Number.isNaN(t) ? Number.POSITIVE_INFINITY : t }
const txt = (a: string | null | undefined, b: string | null | undefined) => (a ?? '').localeCompare(b ?? '', 'pt-BR')

/** Ordena uma CÓPIA, estável. `null` = mantém a ordem recebida. Sem prazo / sem responsável / sem data vão sempre para o fim. */
export function ordenarLinhas<T extends LinhaParaFiltro>(linhas: T[], ordem: OrdemTorre | null): T[] {
  if (!ordem) return linhas
  const cmp: Record<OrdemTorre, (a: T, b: T) => number> = {
    prazo: (a, b) => tempo(a.dataPrazo) - tempo(b.dataPrazo),
    risco: (a, b) => RANK_RISCO[nivelDeRisco(a)] - RANK_RISCO[nivelDeRisco(b)] || tempo(a.dataPrazo) - tempo(b.dataPrazo),
    familia: (a, b) => txt(a.familiaNome ?? a.processoNome, b.familiaNome ?? b.processoNome),
    responsavel: (a, b) => (a.responsavelNome == null ? 1 : 0) - (b.responsavelNome == null ? 1 : 0) || txt(a.responsavelNome, b.responsavelNome),
    criacao: (a, b) => {
      const ta = a.criadaEm ? Date.parse(a.criadaEm) : NaN, tb = b.criadaEm ? Date.parse(b.criadaEm) : NaN
      return (Number.isNaN(ta) ? 1 : 0) - (Number.isNaN(tb) ? 1 : 0) || tb - ta || 0
    },
  }
  return linhas.map((l, i) => ({ l, i })).sort((x, y) => cmp[ordem](x.l, y.l) || x.i - y.i).map((x) => x.l)
}

// ─── a porta única: lista + "Mostrando N de M" ──────────────────────────────
export interface ResumoDaLista<T> { linhas: T[]; mostrando: number; total: number }
/**
 * Filtra E ordena. `mostrando` é o tamanho da lista devolvida; `total` (M) é o tamanho da lista recebida
 * (a lista BASE: nacionalidade + indicador + visão + busca já aplicados pelo chamador). O texto "Mostrando N de M"
 * e a tabela leem DESTE objeto — uma conta só.
 */
export function aplicarFiltros<T extends LinhaParaFiltro>(linhas: T[], f: FiltrosTorre, ctx: ContextoDeFiltro): ResumoDaLista<T> {
  const passam = linhas.filter((l) => linhaPassa(l, f, ctx))
  const ordenadas = ordenarLinhas(passam, f.ordenar)
  return { linhas: ordenadas, mostrando: ordenadas.length, total: linhas.length }
}

/** O texto da barra. */
export const textoMostrando = (r: { mostrando: number; total: number }): string => `Mostrando ${r.mostrando} de ${r.total}`

/** Contador de cada chip de prazo: a MESMA `aplicarFiltros`, com só aquele chip ligado, sobre a lista base. */
export function contarPorPrazo<T extends LinhaParaFiltro>(linhas: T[], ctx: ContextoDeFiltro): Record<PrazoTorre, number> {
  const r = {} as Record<PrazoTorre, number>
  for (const p of PRAZOS_TORRE) r[p] = aplicarFiltros(linhas, { ...filtrosVazios(), prazo: [p] }, ctx).mostrando
  return r
}

// ─── chips ──────────────────────────────────────────────────────────────────
export interface ChipDeFiltro { chave: keyof FiltrosTorre | 'pais' | 'busca'; valor: string | null; rotulo: string }

export interface RotulosDoFiltro {
  pessoa?: (id: string) => string | null
  fase?: (chave: string) => string | null
  orgao?: (id: string) => string | null
}
const dia = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`

/** Um chip por valor ativo (o ✕ remove exatamente aquele valor). Nacionalidade e busca entram na tela, não aqui. */
export function chipsDoFiltro(f: FiltrosTorre, r: RotulosDoFiltro = {}): ChipDeFiltro[] {
  const c: ChipDeFiltro[] = []
  for (const v of f.responsavel) c.push({ chave: 'responsavel', valor: v, rotulo: `Responsável: ${v === 'eu' ? 'Eu' : v === 'sem' ? 'Sem responsável' : r.pessoa?.(v) ?? `#${v}`}` })
  for (const v of f.prazo) c.push({ chave: 'prazo', valor: v, rotulo: `Prazo: ${ROTULO_PRAZO_TORRE[v]}` })
  if (f.prazoDe || f.prazoAte) c.push({ chave: 'prazoDe', valor: null, rotulo: `Prazo: ${f.prazoDe ? `de ${dia(f.prazoDe)}` : ''}${f.prazoDe && f.prazoAte ? ' ' : ''}${f.prazoAte ? `até ${dia(f.prazoAte)}` : ''}` })
  if (f.quando && (f.quandoDe || f.quandoAte)) c.push({ chave: 'quando', valor: null, rotulo: `${ROTULO_QUANDO_TORRE[f.quando]}: ${f.quandoDe ? `de ${dia(f.quandoDe)}` : ''}${f.quandoDe && f.quandoAte ? ' ' : ''}${f.quandoAte ? `até ${dia(f.quandoAte)}` : ''}` })
  if (f.familia) c.push({ chave: 'familia', valor: null, rotulo: `Família: ${f.familia}` })
  for (const v of f.status) c.push({ chave: 'status', valor: v, rotulo: `Status: ${ROTULO_STATUS[v] ?? v}` })
  for (const v of f.certidao) c.push({ chave: 'certidao', valor: v, rotulo: `Certidão: ${ROTULO_CERTIDAO_TORRE[v] ?? v}` })
  for (const v of f.fase) c.push({ chave: 'fase', valor: v, rotulo: `Fase: ${r.fase?.(v) ?? v}` })
  for (const v of f.passo) c.push({ chave: 'passo', valor: v, rotulo: `Passo: ${v}` })
  for (const v of f.orgao) c.push({ chave: 'orgao', valor: v, rotulo: `Cartório: ${v === 'sem' ? 'Sem cartório' : r.orgao?.(v) ?? `#${v}`}` })
  for (const v of f.prioridade) c.push({ chave: 'prioridade', valor: v, rotulo: `Prioridade: ${ROTULO_PRIORIDADE_TORRE[v] ?? v}` })
  for (const v of f.risco) c.push({ chave: 'risco', valor: v, rotulo: `Risco: ${ROTULO_RISCO_TORRE[v]}` })
  if (f.linhaReta) c.push({ chave: 'linhaReta', valor: null, rotulo: 'Só linha reta' })
  for (const v of f.acomp) c.push({ chave: 'acomp', valor: v, rotulo: `Acompanhamento: ${ROTULO_ACOMP_TORRE[v]}` })
  for (const v of f.cobranca) c.push({ chave: 'cobranca', valor: v, rotulo: ROTULO_COBRANCA_TORRE[v] })
  if (f.ordenar) c.push({ chave: 'ordenar', valor: null, rotulo: `Ordenar por: ${ROTULO_ORDEM_TORRE[f.ordenar]}` })
  return c
}

/** Tira do estado o que um chip representa (o ✕). `valor = null` zera o filtro inteiro daquela chave. */
export function removerChip(f: FiltrosTorre, chip: Pick<ChipDeFiltro, 'chave' | 'valor'>): FiltrosTorre {
  const n = normalizarFiltros(f as unknown as Record<string, unknown>)
  switch (chip.chave) {
    case 'prazoDe': case 'prazoAte': return { ...n, prazoDe: null, prazoAte: null }
    case 'quando': case 'quandoDe': case 'quandoAte': return { ...n, quando: null, quandoDe: null, quandoAte: null }
    case 'familia': return { ...n, familia: null }
    case 'linhaReta': return { ...n, linhaReta: false }
    case 'ordenar': return { ...n, ordenar: null }
    case 'responsavel': case 'prazo': case 'status': case 'certidao': case 'fase': case 'passo': case 'orgao': case 'prioridade': case 'risco': case 'acomp': case 'cobranca': {
      const k = chip.chave
      const atual = n[k] as string[]
      return { ...n, [k]: chip.valor == null ? [] : atual.filter((x) => x !== chip.valor) } as FiltrosTorre
    }
    default: return n
  }
}

/** Quantos filtros estão ligados (a ordenação não é filtro; o intervalo de prazo e o de "quando" contam um cada). */
export function contarFiltrosAtivos(f: FiltrosTorre): number {
  return chipsDoFiltro(f).filter((c) => c.chave !== 'ordenar').length
}

/** Os que moram em "Mais filtros" (o resto é visível): para o botão mostrar quantos há escondidos. */
export const CHAVES_EM_MAIS_FILTROS: ReadonlyArray<keyof FiltrosTorre> = ['quando', 'quandoDe', 'quandoAte', 'fase', 'passo', 'prioridade', 'linhaReta', 'acomp', 'cobranca']
export function contarEmMaisFiltros(f: FiltrosTorre): number {
  return chipsDoFiltro(f).filter((c) => (CHAVES_EM_MAIS_FILTROS as readonly string[]).includes(c.chave)).length
}

// ─── opções (vêm das linhas — só o que existe em tarefa aberta) ──────────────
export interface OpcoesDosFiltros {
  familias: string[]
  pessoas: Array<{ id: string; nome: string }>
  status: string[]
  fases: string[]
  passos: string[]
  orgaos: Array<{ id: string; nome: string }>
}
export function opcoesDosFiltros(linhas: LinhaParaFiltro[]): OpcoesDosFiltros {
  const familias = new Set<string>(), status = new Set<string>(), fases = new Set<string>(), passos = new Set<string>()
  const pessoas = new Map<string, string>(), orgaos = new Map<string, string>()
  for (const l of linhas) {
    const fam = l.familiaNome ?? l.processoNome; if (fam) familias.add(fam)
    status.add(l.statusTarefa)
    if (l.faseMacroKey) fases.add(l.faseMacroKey)
    const p = nomeDoPasso(l); if (p) passos.add(p)
    if (l.responsavelId != null && l.responsavelNome) pessoas.set(String(l.responsavelId), l.responsavelNome)
    if (l.orgaoId != null && l.terceiroNome) orgaos.set(String(l.orgaoId), l.terceiroNome)
  }
  const ord = (s: Iterable<string>) => [...s].sort((a, b) => a.localeCompare(b, 'pt-BR'))
  const pares = (m: Map<string, string>) => [...m.entries()].map(([id, nome]) => ({ id, nome })).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))
  return { familias: ord(familias), pessoas: pares(pessoas), status: ord(status), fases: ord(fases), passos: ord(passos), orgaos: pares(orgaos) }
}

/** Sugestões do campo Família: só famílias COM tarefa aberta (as da lista base), que contêm o que foi digitado. */
export function sugestoesDeFamilia(linhas: Array<Pick<LinhaParaFiltro, 'familiaNome' | 'processoNome'>>, digitado: string, max = 8): string[] {
  const t = semAcento(digitado)
  const s = new Set<string>()
  for (const l of linhas) { const n = l.familiaNome ?? l.processoNome; if (n && (!t || semAcento(n).includes(t))) s.add(n) }
  return [...s].sort((a, b) => a.localeCompare(b, 'pt-BR')).slice(0, max)
}
