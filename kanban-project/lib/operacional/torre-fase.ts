// lib/operacional/torre-fase.ts
// ============================================================================
// A ABA PROCESSOS (POR FASE) — regras PURAS: filtros, busca, ordenação, paginação, "Saúde da fase" e "Onde estão as certidões
// desta fase — por passo". Sem Prisma, sem relógio: a tela e os testes usam as MESMAS funções, sobre a lista consolidada
// (`ProcessoDaTorre`, de `torre-processos.ts`). Nada de nome de fase, passo ou meta digitado aqui: tudo vem do cadastro/dos dados.
//
// Regras do protótipo (inventário §1.4 e §2.9) e como ficaram:
//   • situação de cada linha = `situacaoDaFase` da regra única de risco (`torre-risco.ts`): ok · at · pa · sd;
//   • filtros: Todos · Precisam de alguém (≠ ok) · Atenção (at) · Parados ou sem dono (pa + sd);
//   • busca: sem acento/maiúsculas em família + próxima ação + responsável;
//   • País e Responsável: igualdade exata; combinam em E com situação e busca;
//   • ordens: "mais atrasado primeiro" (Parado → Sem dono → Atenção → No ritmo; desempate prazo) · "Prazo mais próximo" ·
//     "Entrou na fase há mais tempo" · "Família A–Z" (pt-BR);
//   • "Na fase há": "N d / meta" — vermelho se passou da meta, âmbar acima de 80% dela (no protótipo a meta é 30 e os cortes fixos
//     30 e 24: 24 = 80% de 30 — aqui o corte acompanha a meta de cada fase); sem meta, sem cor;
//   • paginação REAL (12 por página).
// ============================================================================
import { diasPorExtenso } from './tempo-extenso'
import type { ProcessoDaTorre, ColunaDoRadar, PassoDoProcesso } from './torre-processos'
import { PESO_DA_SITUACAO } from './torre-risco'
import { textoTempoNaFase, textoTempoNaFaseCurto } from './torre-predicados'

export const ITENS_POR_PAGINA = 12

export type FiltroDeProcessos = 'todos' | 'precisam' | 'atencao' | 'parados'
export type OrdemDeProcessos = 'atrasado' | 'prazo' | 'tempo' | 'az'

export const FILTROS_DE_PROCESSOS: ReadonlyArray<{ chave: FiltroDeProcessos; rotulo: string }> = [
  { chave: 'todos', rotulo: 'Todos' }, { chave: 'precisam', rotulo: 'Precisam de alguém' },
  { chave: 'atencao', rotulo: 'Atenção' }, { chave: 'parados', rotulo: 'Parados ou sem dono' },
]
export const ORDENS_DE_PROCESSOS: ReadonlyArray<{ chave: OrdemDeProcessos; rotulo: string }> = [
  { chave: 'atrasado', rotulo: 'Ordenar: mais atrasado primeiro' }, { chave: 'prazo', rotulo: 'Prazo mais próximo' },
  { chave: 'tempo', rotulo: 'Entrou na fase há mais tempo' }, { chave: 'az', rotulo: 'Família A–Z' },
]
export const TODOS_OS_PAISES = 'Todos os países'
export const TODOS_OS_RESPONSAVEIS = 'Todos os responsáveis'
export const SEM_RESPONSAVEL = 'Sem responsável'

/** 1.186 — separador de milhar pt-BR sem depender de `toLocaleString` (o fuso/locale do navegador não entra na tela). */
export const milhar = (n: number): string => String(Math.trunc(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.')

export const semAcento = (x: string | null | undefined): string => String(x ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

// ─── TEMPO E COR ──────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Por extenso: "52 dias" · "1 dia" · "menos de 1 dia" · "4,1 meses" (100 dias ou mais) · "—" sem registro. `curto` (só o selo do Radar): "52 d" · "8 h" · "4,1 m". */
export function textoDuracao(dias: number | null, horas: number | null = null, curto = false): string {
  if (dias == null) return '—'
  if (dias >= 100) return `${(dias / 30).toFixed(1).replace('.', ',')} ${curto ? 'm' : 'meses'}`
  const t = { dias, horas: horas ?? dias * 24 }
  return curto ? textoTempoNaFaseCurto(t) : textoTempoNaFase(t)
}

/** Dias em número (h/24, m×30) — a conversão do protótipo para ordenar "mais tempo na fase". */
export const diasComoNumero = (dias: number | null, horas: number | null): number => (dias == null ? -1 : dias >= 1 ? dias : (horas ?? 0) / 24)

export type TomDosDias = 'vermelho' | 'ambar' | 'normal'
export function tomDosDias(dias: number | null, metaDias: number | null): TomDosDias {
  if (dias == null || metaDias == null || metaDias <= 0) return 'normal'
  if (dias > metaDias) return 'vermelho'
  if (dias > metaDias * 0.8) return 'ambar'
  return 'normal'
}

/** "52 dias / 30 dias" — a meta só aparece quando existe. */
export const textoNaFase = (p: Pick<ProcessoDaTorre, 'naFase' | 'metaDias'>): string => {
  const t = textoDuracao(p.naFase.dias, p.naFase.horas)
  return p.metaDias != null && p.naFase.dias != null ? `${t} / ${diasPorExtenso(p.metaDias)}` : t
}

// ─── FASES (botões) ───────────────────────────────────────────────────────────────────────────────────────────────────────

export interface BotaoDeFase { key: string; label: string; n: number }
export const botoesDeFase = (colunas: ColunaDoRadar[], processos: ProcessoDaTorre[]): BotaoDeFase[] =>
  colunas.map((c) => ({ key: c.key, label: c.label, n: processos.filter((p) => p.faseAtual.key === c.key).length }))

/** A fase aberta ao entrar: a de MAIOR volume (no protótipo, Emissão); empate → a primeira do cadastro; sem nenhuma, a primeira. */
export const escolherFaseInicial = (botoes: BotaoDeFase[]): string | null =>
  botoes.reduce<BotaoDeFase | null>((melhor, b) => (melhor == null || b.n > melhor.n ? b : melhor), null)?.key ?? null

// ─── LINHA DA TABELA ──────────────────────────────────────────────────────────────────────────────────────────────────────

/** O responsável DA LINHA = o da tarefa que manda na próxima ação; `null` = sem responsável; `undefined` = sem próxima ação. */
export const responsavelDaLinha = (p: ProcessoDaTorre): string | null | undefined => (p.proximaAcao ? p.proximaAcao.responsavelNome : undefined)

/** O texto da busca: família + próxima ação + responsável (+ código). */
export const textoDeBusca = (p: ProcessoDaTorre): string => semAcento(`${p.familiaNome} ${p.codigo ?? ''} ${p.proximaAcao?.texto ?? ''} ${p.proximaAcao?.responsavelNome ?? ''}`)

// ─── FILTRAR · ORDENAR · PAGINAR ──────────────────────────────────────────────────────────────────────────────────────────

export interface ParametrosDeProcessos {
  filtro: FiltroDeProcessos
  pais: string
  resp: string
  busca: string
  ordem: OrdemDeProcessos
}
export const PARAMETROS_INICIAIS: ParametrosDeProcessos = { filtro: 'todos', pais: TODOS_OS_PAISES, resp: TODOS_OS_RESPONSAVEIS, busca: '', ordem: 'atrasado' }

export const passaNoFiltro = (p: ProcessoDaTorre, f: FiltroDeProcessos): boolean =>
  f === 'todos' || (f === 'precisam' && p.situacao !== 'ok') || (f === 'atencao' && p.situacao === 'at') || (f === 'parados' && (p.situacao === 'pa' || p.situacao === 'sd'))

/** País + Responsável + busca (tudo menos o botão de situação) — a base das contagens dos botões. */
export function aplicarPaisRespBusca(linhas: ProcessoDaTorre[], par: Pick<ParametrosDeProcessos, 'pais' | 'resp' | 'busca'>): ProcessoDaTorre[] {
  const q = semAcento(par.busca.trim())
  return linhas.filter((p) =>
    (par.pais === TODOS_OS_PAISES || p.pais === par.pais)
    && (par.resp === TODOS_OS_RESPONSAVEIS || (par.resp === SEM_RESPONSAVEL ? responsavelDaLinha(p) === null : responsavelDaLinha(p) === par.resp))
    && (!q || textoDeBusca(p).includes(q)))
}

export interface ContagensDoFiltro { todos: number; precisam: number; atencao: number; parados: number }
export function contagensDosFiltros(base: ProcessoDaTorre[]): ContagensDoFiltro {
  return {
    todos: base.length,
    precisam: base.filter((p) => p.situacao !== 'ok').length,
    atencao: base.filter((p) => p.situacao === 'at').length,
    parados: base.filter((p) => p.situacao === 'pa' || p.situacao === 'sd').length,
  }
}

/** O prazo como número de dia (ms); sem prazo vai para o fim. */
const prazoMs = (p: ProcessoDaTorre): number => (p.proximaAcao?.dataPrazo ? new Date(p.proximaAcao.dataPrazo).getTime() : Number.POSITIVE_INFINITY)

export function ordenarProcessos(linhas: ProcessoDaTorre[], ordem: OrdemDeProcessos): ProcessoDaTorre[] {
  const az = (a: ProcessoDaTorre, b: ProcessoDaTorre) => a.familiaNome.localeCompare(b.familiaNome, 'pt-BR')
  const porPrazo = (a: ProcessoDaTorre, b: ProcessoDaTorre) => (prazoMs(a) === prazoMs(b) ? 0 : prazoMs(a) < prazoMs(b) ? -1 : 1)
  const cmp =
    ordem === 'prazo' ? (a: ProcessoDaTorre, b: ProcessoDaTorre) => porPrazo(a, b) || az(a, b)
    : ordem === 'tempo' ? (a: ProcessoDaTorre, b: ProcessoDaTorre) => diasComoNumero(b.naFase.dias, b.naFase.horas) - diasComoNumero(a.naFase.dias, a.naFase.horas) || az(a, b)
    : ordem === 'az' ? az
    : (a: ProcessoDaTorre, b: ProcessoDaTorre) => PESO_DA_SITUACAO[a.situacao] - PESO_DA_SITUACAO[b.situacao] || porPrazo(a, b) || az(a, b)
  return [...linhas].sort(cmp)
}

export interface Pagina<T> { itens: T[]; pagina: number; totalPaginas: number; total: number; de: number; ate: number }
/** Paginação real: a página pedida é travada em [1, total]. `de`/`ate` = posição (1-based) do primeiro/último item. */
export function paginar<T>(itens: T[], pagina: number, porPagina = ITENS_POR_PAGINA): Pagina<T> {
  const totalPaginas = Math.max(1, Math.ceil(itens.length / porPagina))
  const p = Math.min(Math.max(1, Math.floor(pagina) || 1), totalPaginas)
  const ini = (p - 1) * porPagina
  const fatia = itens.slice(ini, ini + porPagina)
  return { itens: fatia, pagina: p, totalPaginas, total: itens.length, de: fatia.length ? ini + 1 : 0, ate: ini + fatia.length }
}

/** Os números do rodapé da paginação: 1 … 4 5 6 … 36 (primeira, última, vizinhas da atual e reticências). */
export function paginasVisiveis(atual: number, total: number): Array<number | '…'> {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1)
  const set = new Set([1, 2, total - 1, total, atual - 1, atual, atual + 1].filter((n) => n >= 1 && n <= total))
  const ordenadas = [...set].sort((a, b) => a - b)
  const saida: Array<number | '…'> = []
  ordenadas.forEach((n, i) => { if (i > 0 && n - ordenadas[i - 1] > 1) saida.push('…'); saida.push(n) })
  return saida
}

/** T222: "Mostrando N de <nº do filtro> processos da fase · 12 por página" — N = quantas linhas a página mostra. */
export const rodapeDeProcessos = (pg: Pagina<unknown>, porPagina = ITENS_POR_PAGINA): string =>
  pg.total === 0 ? 'Nenhum processo encontrado com esses filtros.' : `Mostrando ${pg.itens.length} de ${pg.total} ${pg.total === 1 ? 'processo' : 'processos'} da fase · ${porPagina} por página`

/** As opções do select País: "Todos os países" + os países presentes. */
export const opcoesDePais = (linhas: Array<{ pais: string | null }>): string[] =>
  [TODOS_OS_PAISES, ...[...new Set(linhas.map((p) => p.pais).filter((x): x is string => !!x))].sort((a, b) => a.localeCompare(b, 'pt-BR'))]
/** As opções do select Responsável: "Todos os responsáveis" + quem aparece como responsável + "Sem responsável" (se houver). */
export function opcoesDeResponsavel(linhas: ProcessoDaTorre[]): string[] {
  const nomes = [...new Set(linhas.map(responsavelDaLinha).filter((x): x is string => !!x))].sort((a, b) => a.localeCompare(b, 'pt-BR'))
  return [TODOS_OS_RESPONSAVEIS, ...nomes, ...(linhas.some((p) => responsavelDaLinha(p) === null) ? [SEM_RESPONSAVEL] : [])]
}

// ─── SAÚDE DA FASE ────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface FluxoDaFase { entraram: number; sairam: Array<{ para: string; n: number }> }

export interface SaudeDaFase {
  total: number
  ok: number
  atencao: number
  /** Parados + sem dono (a mesma soma do botão "Parados ou sem dono"). */
  parados: number
  /** Tempo médio real da fase (log de transições), `null` = nenhuma permanência completa registrada ("—"). */
  tempoMedioDias: number | null
  metaDias: number | null
  /** Tempo médio acima da meta → vermelho; senão verde. */
  acimaDaMeta: boolean
  /** Largura de cada trecho da barra, em % com 1 casa (valor/total). */
  barra: { ok: number; atencao: number; parados: number }
  semana: string
}

const pct1 = (v: number, total: number): number => (total > 0 ? Math.round((v / total) * 1000) / 10 : 0)

/** A frase da semana: "Entraram 14 esta semana · saíram 11 para Análise. Se o ritmo continuar, a fase cresce 3 processos/semana." */
export function fraseDaSemana(fluxo: FluxoDaFase | null, rotuloDaFase: (phaseKey: string) => string): string {
  if (!fluxo || (fluxo.entraram === 0 && fluxo.sairam.length === 0)) return 'Nenhum processo entrou nem saiu desta fase esta semana.'
  const saidas = fluxo.sairam.reduce((s, x) => s + x.n, 0)
  const destino = fluxo.sairam.length === 1 ? ` para ${rotuloDaFase(fluxo.sairam[0].para)}`
    : fluxo.sairam.length > 1 ? ` (${fluxo.sairam.map((x) => `${x.n} para ${rotuloDaFase(x.para)}`).join(', ')})` : ''
  const cresce = fluxo.entraram > saidas ? ` Se o ritmo continuar, a fase cresce ${fluxo.entraram - saidas} ${fluxo.entraram - saidas === 1 ? 'processo' : 'processos'}/semana.` : ''
  return `Entraram ${fluxo.entraram} esta semana · saíram ${saidas}${destino}.${cresce}`
}

export function saudeDaFase(
  linhasDaFase: ProcessoDaTorre[],
  dados: { tempoMedioDias: number | null; metaDias: number | null; fluxo: FluxoDaFase | null; rotuloDaFase: (phaseKey: string) => string },
): SaudeDaFase {
  const c = contagensDosFiltros(linhasDaFase)
  const total = linhasDaFase.length
  const ok = total - c.precisam
  return {
    total, ok, atencao: c.atencao, parados: c.parados,
    tempoMedioDias: dados.tempoMedioDias, metaDias: dados.metaDias,
    acimaDaMeta: dados.tempoMedioDias != null && dados.metaDias != null && dados.metaDias > 0 && Math.round(dados.tempoMedioDias) > dados.metaDias, // em dias inteiros, como o funil (`estourouAMeta`)
    barra: { ok: pct1(ok, total), atencao: pct1(c.atencao, total), parados: pct1(c.parados, total) },
    semana: fraseDaSemana(dados.fluxo, dados.rotuloDaFase),
  }
}

/**
 * A META mostrada no cartão: a meta que TODOS os processos da fase compartilham (a do país, se for um país só); se divergem entre
 * países, a meta padrão da fase; sem nenhuma, `null` ("—").
 */
export function metaDaVisao(linhasDaFase: Array<Pick<ProcessoDaTorre, 'metaDias'>>, metaPadrao: number | null): number | null {
  const metas = new Set(linhasDaFase.map((p) => p.metaDias))
  if (metas.size === 1) { const [m] = [...metas]; return m ?? metaPadrao }
  return metaPadrao
}

// ─── ONDE ESTÃO AS CERTIDÕES DESTA FASE — POR PASSO ───────────────────────────────────────────────────────────────────────────

export type ClasseDaCaixa = 'r' | 'n' | 'a' | 'g'
export interface CaixaDoPasso { chave: string; nome: string; obs: string; n: number; classe: ClasseDaCaixa }
export interface PassosDaFase {
  /** Todas as tarefas da fase (abertas + concluídas) — o número do título. */
  total: number
  substantivo: 'certidões' | 'tarefas'
  /** SÓ passos reais (+ "Concluídas"). "Sem responsável" NÃO é passo: vem à parte, em `semResponsavel`. */
  caixas: CaixaDoPasso[]
  /** Tarefas abertas sem responsável — mostradas numa linha separada, para a soma continuar batendo com `total`. */
  semResponsavel: number
  gargalo: string
}

/** A soma do que o cartão mostra: cada caixa + a linha de "sem responsável". Tem de ser igual a `total`. */
export const somaExibidaDosPassos = (p: Pick<PassosDaFase, 'caixas' | 'semResponsavel'>): number => p.caixas.reduce((a, c) => a + c.n, 0) + p.semResponsavel

/**
 * O CARTÃO POR PASSO — grain TAREFA (a certidão é a unidade de trabalho; um passo NÃO multiplica a contagem). Caixas, na ordem:
 * "Sem responsável" (vermelha) · cada passo do roteiro com tarefa aberta COM responsável (âmbar se a maioria espera terceiro/cliente,
 * neutra se não) · "Concluídas" (verde). Os nomes dos passos vêm das tarefas (o cadastro do workflow), nunca de texto fixo.
 * A frase do gargalo aponta o passo com mais volume e, nas esperas, quantas passaram da meta da fase.
 */
export function passosDaFase(linhasDaFase: ProcessoDaTorre[], metaDias: number | null): PassosDaFase {
  const semResp = linhasDaFase.reduce((s, p) => s + p.tarefasDaFase.semResponsavel, 0)
  const concl = linhasDaFase.reduce((s, p) => s + p.tarefasDaFase.concluidas, 0)
  const abertas = linhasDaFase.reduce((s, p) => s + p.tarefasDaFase.abertas, 0)
  const ehCertidao = linhasDaFase.some((p) => p.tarefasDaFase.ehCertidao)
  const substantivo = ehCertidao ? 'certidões' as const : 'tarefas' as const

  const agregado = new Map<string, PassoDoProcesso>()
  for (const p of linhasDaFase) for (const x of p.tarefasDaFase.passos) {
    const a = agregado.get(x.chave) ?? { ...x, n: 0, aguardando: 0, acimaDaMeta: 0, ordem: x.ordem }
    a.n += x.n; a.aguardando += x.aguardando; a.acimaDaMeta += x.acimaDaMeta; a.ordem = Math.max(a.ordem, x.ordem)
    agregado.set(x.chave, a)
  }
  const passos = [...agregado.values()].sort((a, b) => a.ordem - b.ordem || a.label.localeCompare(b.label, 'pt-BR'))

  const caixas: CaixaDoPasso[] = []
  for (const x of passos) {
    const espera = x.aguardando * 2 >= x.n
    const obs = x.acimaDaMeta > 0 && metaDias != null ? `${x.acimaDaMeta} há mais de ${diasPorExtenso(metaDias)}`
      : espera && metaDias != null ? `nenhuma há mais de ${diasPorExtenso(metaDias)}` : ''
    caixas.push({ chave: x.chave, nome: x.label, obs, n: x.n, classe: espera ? 'a' : 'n' })
  }
  caixas.push({ chave: '__concluidas', nome: 'Concluídas', obs: 'feitas nesta fase', n: concl, classe: 'g' })

  let gargalo: string
  const maior = [...passos].sort((a, b) => b.n - a.n)[0]
  if (abertas === 0) gargalo = concl > 0 ? `Nenhuma ${substantivo === 'certidões' ? 'certidão' : 'tarefa'} aberta: tudo o que havia nesta fase está concluído.` : `Nenhuma ${substantivo === 'certidões' ? 'certidão' : 'tarefa'} nesta fase ainda.`
  else if (!maior || semResp > maior.n) gargalo = `O maior volume está sem responsável: ${milhar(semResp)} ${substantivo}. Distribuir é o próximo passo.`
  else {
    const parado = maior.aguardando * 2 >= maior.n
    const extra = maior.acimaDaMeta > 0 && metaDias != null ? `, ${milhar(maior.acimaDaMeta)} há mais de ${diasPorExtenso(metaDias)}` : ''
    gargalo = `O passo com mais volume${parado ? ' parado' : ''} é ${maior.label}: ${milhar(maior.n)} ${substantivo}${extra}.`
  }
  return { total: abertas + concl, substantivo, caixas, semResponsavel: semResp, gargalo }
}
