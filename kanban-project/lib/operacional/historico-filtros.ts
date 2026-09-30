// lib/operacional/historico-filtros.ts
// ============================================================================
// HISTÓRICO DO PROCESSO — filtros, dias, contadores e rodapé (módulo PURO).
//
// Lê só a lista de FATOS que `historico-processo.ts` montou. A MESMA função serve
// a aba "Histórico" do processo, o Foco da família na Torre e as exportações
// (CSV/PDF): o que está filtrado na tela é exatamente o que sai no arquivo.
//
// FUSO: tudo que é dia/hora é formatado com `timeZone: 'America/Sao_Paulo'`
// EXPLÍCITO — o servidor (UTC) e o navegador (qualquer fuso) escrevem o mesmo
// texto, então não há diferença de hidratação.
//
// REGRA ESCRITA DOS CONTADORES (corrige "Documentos 0 / Alterações 2", que contava
// por `entidade` de log e nunca batia com o que aconteceu):
//   • "Mostrando N de M fatos":  M = todos os fatos do processo (cartões, inclusive
//     os automáticos ocultos); N = os que passam em TODOS os filtros.
//   • Por dia: "K fatos · J ocultos (automáticos)":  K = cartões visíveis do dia;
//     J = automáticos do dia que só o filtro "Ocultar automáticos" escondeu.
//   • Números dentro dos seletores (Quem / Tipo / Pessoa): quantos cartões cada
//     opção traria, aplicados TODOS os outros filtros (contagem facetada) — um
//     número entre parênteses nunca promete o que o clique não entrega.
//   • Rodapé (considera o conjunto que passa nos filtros, contando os automáticos
//     mesmo ocultos): fatos no período = cartões; pessoas que atuaram = autores
//     humanos distintos; cancelamentos = soma das certidões canceladas (um cartão
//     agrupado conta N); certidões validadas = soma das certidões validadas;
//     último fato = o mais recente.
// ============================================================================
import { TIPOS_DE_FATO, ROTULO_TIPO_DE_FATO, type FatoDoHistorico, type SubtipoDeFato, type TipoDeFato } from './historico-processo'

export const FUSO_DO_HISTORICO = 'America/Sao_Paulo'

export type PeriodoDoHistorico = 'hoje' | '7d' | '30d' | 'todo' | 'intervalo'

export interface FiltrosDoHistorico {
  busca: string
  periodo: PeriodoDoHistorico
  /** YYYY-MM-DD (dia de São Paulo) — só com `periodo: 'intervalo'`. */
  de: string | null
  ate: string | null
  /** 'todos' | 'sistema' | `u:${usuarioId}` */
  quem: string
  tipo: TipoDeFato | 'todos'
  pessoaId: number | 'todas'
  ocultarAutomaticos: boolean
}

/** Ao abrir: últimos 7 dias, sem automáticos (como no protótipo aprovado). */
export const FILTROS_PADRAO: FiltrosDoHistorico = { busca: '', periodo: '7d', de: null, ate: null, quem: 'todos', tipo: 'todos', pessoaId: 'todas', ocultarAutomaticos: true }
/** "Limpar filtros": nada filtrado, automáticos visíveis. */
export const FILTROS_LIMPOS: FiltrosDoHistorico = { busca: '', periodo: 'todo', de: null, ate: null, quem: 'todos', tipo: 'todos', pessoaId: 'todas', ocultarAutomaticos: false }

// ─── DIA E HORA (sempre São Paulo) ──────────────────────────────────────────
const fDia = new Intl.DateTimeFormat('en-CA', { timeZone: FUSO_DO_HISTORICO, year: 'numeric', month: '2-digit', day: '2-digit' })
const fHora = new Intl.DateTimeFormat('pt-BR', { timeZone: FUSO_DO_HISTORICO, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
const fDiaLongo = new Intl.DateTimeFormat('pt-BR', { timeZone: FUSO_DO_HISTORICO, weekday: 'long', day: 'numeric', month: 'long' })
const fDiaLongoAno = new Intl.DateTimeFormat('pt-BR', { timeZone: FUSO_DO_HISTORICO, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
const fDataCurta = new Intl.DateTimeFormat('pt-BR', { timeZone: FUSO_DO_HISTORICO, day: '2-digit', month: '2-digit' })
const fDataCompleta = new Intl.DateTimeFormat('pt-BR', { timeZone: FUSO_DO_HISTORICO, day: '2-digit', month: '2-digit', year: 'numeric' })

/** 'YYYY-MM-DD' do dia em São Paulo. */
export const diaSP = (iso: string | Date): string => fDia.format(typeof iso === 'string' ? new Date(iso) : iso)
/** 'HH:mm' em São Paulo. */
export const horaSP = (iso: string | Date): string => fHora.format(typeof iso === 'string' ? new Date(iso) : iso)
/** '30/09/2026 12:15' — para CSV/PDF. */
export const dataHoraSP = (iso: string | Date): string => { const d = typeof iso === 'string' ? new Date(iso) : iso; return `${fDataCompleta.format(d)} ${fHora.format(d)}` }

const somaDias = (dia: string, n: number): string => {
  const [a, m, d] = dia.split('-').map(Number)
  return new Date(Date.UTC(a, m - 1, d + n)).toISOString().slice(0, 10)
}

/** "Hoje · quarta-feira, 30 de setembro" / "Ontem · terça-feira, 29 de setembro" / "segunda-feira, 12 de janeiro de 2026". */
export function rotuloDoDia(dia: string, agora: Date): string {
  const hoje = diaSP(agora)
  const ref = new Date(`${dia}T12:00:00-03:00`) // meio-dia evita virar de dia em qualquer deslocamento
  const mesmoAno = dia.slice(0, 4) === hoje.slice(0, 4)
  const longo = (mesmoAno ? fDiaLongo : fDiaLongoAno).format(ref)
  if (dia === hoje) return `Hoje · ${longo}`
  if (dia === somaDias(hoje, -1)) return `Ontem · ${longo}`
  return longo
}

/** "hoje, 12:15" / "ontem, 18:00" / "29/09, 18:00" / "29/09/2025, 18:00". */
export function rotuloDoMomento(iso: string, agora: Date): string {
  const dia = diaSP(iso), hoje = diaSP(agora)
  const hora = horaSP(iso)
  if (dia === hoje) return `hoje, ${hora}`
  if (dia === somaDias(hoje, -1)) return `ontem, ${hora}`
  return `${dia.slice(0, 4) === hoje.slice(0, 4) ? fDataCurta.format(new Date(iso)) : fDataCompleta.format(new Date(iso))}, ${hora}`
}

// ─── FILTRAGEM ──────────────────────────────────────────────────────────────
const semAcento = (t: string) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()

function textoDeBusca(f: FatoDoHistorico): string {
  return semAcento([
    f.frase, f.quem.nome, f.certidao, f.pessoa, f.fase, f.passo, f.motivo, f.justificativa, f.efeito, f.rotuloSubtipo,
    ...f.agrupadoDe.map((i) => i.frase),
  ].filter(Boolean).join(' '))
}

function limitesDoPeriodo(fil: FiltrosDoHistorico, agora: Date): { de: string | null; ate: string | null } {
  const hoje = diaSP(agora)
  switch (fil.periodo) {
    case 'hoje': return { de: hoje, ate: hoje }
    case '7d': return { de: somaDias(hoje, -6), ate: hoje }
    case '30d': return { de: somaDias(hoje, -29), ate: hoje }
    case 'intervalo': return { de: fil.de, ate: fil.ate }
    default: return { de: null, ate: null }
  }
}

type Ignorar = 'quem' | 'tipo' | 'pessoa' | 'automaticos' | null

/** O fato passa em todos os filtros (menos o que `ignorar` manda pular)? */
export function passaNosFiltros(f: FatoDoHistorico, fil: FiltrosDoHistorico, agora: Date, ignorar: Ignorar = null): boolean {
  const { de, ate } = limitesDoPeriodo(fil, agora)
  const dia = diaSP(f.quando)
  if (de && dia < de) return false
  if (ate && dia > ate) return false
  if (ignorar !== 'automaticos' && fil.ocultarAutomaticos && f.automatico) return false
  if (ignorar !== 'quem' && fil.quem !== 'todos') {
    if (fil.quem === 'sistema') { if (f.quem.tipo !== 'sistema') return false }
    else if (!(f.quem.tipo === 'humano' && fil.quem === `u:${f.quem.id}`)) return false
  }
  if (ignorar !== 'tipo' && fil.tipo !== 'todos' && f.tipo !== fil.tipo) return false
  if (ignorar !== 'pessoa' && fil.pessoaId !== 'todas') {
    const nasPessoas = f.pessoaId === fil.pessoaId || f.agrupadoDe.some((i) => i.links.pessoaId === fil.pessoaId)
    if (!nasPessoas) return false
  }
  const termos = semAcento(fil.busca).split(/\s+/).filter(Boolean)
  if (termos.length) { const alvo = textoDeBusca(f); if (!termos.every((t) => alvo.includes(t))) return false }
  return true
}

export const filtrarFatos = (fatos: FatoDoHistorico[], fil: FiltrosDoHistorico, agora: Date): FatoDoHistorico[] => fatos.filter((f) => passaNosFiltros(f, fil, agora))

// ─── VISÃO COMPLETA (o que a tela e as exportações consomem) ────────────────
export interface DiaDoHistorico { dia: string; rotulo: string; fatos: FatoDoHistorico[]; ocultosAutomaticos: number; ocultosDescricao: string }
export interface OpcaoDeFiltro<V> { valor: V; rotulo: string; n: number }
export interface ChipDeFiltro { chave: 'periodo' | 'busca' | 'quem' | 'tipo' | 'pessoa' | 'automaticos'; rotulo: string }
export interface RodapeDoHistorico { fatosNoPeriodo: number; pessoasQueAtuaram: string[]; cancelamentos: number; certidoesValidadas: number; ultimoFato: string | null }
export interface VisaoDoHistorico {
  visiveis: FatoDoHistorico[]
  mostrando: number
  total: number
  dias: DiaDoHistorico[]
  automaticosOcultos: number
  opcoes: { quem: OpcaoDeFiltro<string>[]; tipo: OpcaoDeFiltro<TipoDeFato | 'todos'>[]; pessoa: OpcaoDeFiltro<number | 'todas'>[] }
  chips: ChipDeFiltro[]
  rodape: RodapeDoHistorico
}

/** O que cada automático é, em poucas palavras — para o aviso "N fatos automáticos ocultos (…)". */
const ROTULO_AUTOMATICO: Partial<Record<SubtipoDeFato, string>> = {
  linhagem: 'recálculo da linhagem', conferencia: 'conferência da árvore', preparo_fase: 'preparo da fase', tarefa_criada: 'criação de tarefas',
  exigencia_criada: 'exigências da árvore', exigencia_removida: 'exigências da árvore', exigencia_reativada: 'exigências da árvore', nao_exigida: 'exigências da árvore',
  exigencia_sem_causa: 'exigências da árvore', espera_terceiro: 'espera do cartório', localizada: 'registros localizados', cancelada: 'cancelamentos do sistema',
  atribuida: 'atribuições do sistema', etapa_concluida: 'etapas concluídas', edicao: 'edição do processo',
}
const ROTULO_PERIODO: Record<PeriodoDoHistorico, string> = { hoje: 'Hoje', '7d': 'Últimos 7 dias', '30d': 'Últimos 30 dias', todo: 'Todo o período', intervalo: 'Intervalo' }
export const ROTULOS_DE_PERIODO = ROTULO_PERIODO

export function montarVisao(fatos: FatoDoHistorico[], fil: FiltrosDoHistorico, agora: Date): VisaoDoHistorico {
  const visiveis = fatos.filter((f) => passaNosFiltros(f, fil, agora))
  const semOcultar = fatos.filter((f) => passaNosFiltros(f, fil, agora, 'automaticos'))

  const porDia = new Map<string, FatoDoHistorico[]>()
  for (const f of visiveis) { const d = diaSP(f.quando); const l = porDia.get(d); if (l) l.push(f); else porDia.set(d, [f]) }
  const ocultosPorDia = new Map<string, FatoDoHistorico[]>()
  if (fil.ocultarAutomaticos) for (const f of semOcultar) if (f.automatico) { const d = diaSP(f.quando); const l = ocultosPorDia.get(d); if (l) l.push(f); else ocultosPorDia.set(d, [f]) }
  const descreverOcultos = (lista: FatoDoHistorico[]) => [...new Set(lista.map((f) => ROTULO_AUTOMATICO[f.subtipo] ?? f.rotuloSubtipo.toLowerCase()))].join(', ')
  const dias: DiaDoHistorico[] = [...new Set([...porDia.keys(), ...ocultosPorDia.keys()])].sort().reverse().map((dia) => ({
    dia, rotulo: rotuloDoDia(dia, agora), fatos: porDia.get(dia) ?? [],
    ocultosAutomaticos: ocultosPorDia.get(dia)?.length ?? 0, ocultosDescricao: descreverOcultos(ocultosPorDia.get(dia) ?? []),
  }))

  // Opções facetadas: cada seletor conta aplicando TODOS os outros filtros.
  const paraQuem = fatos.filter((f) => passaNosFiltros(f, fil, agora, 'quem'))
  const humanos = new Map<number, { nome: string; n: number }>()
  let sistema = 0
  for (const f of paraQuem) { if (f.quem.tipo === 'sistema') sistema++; else if (f.quem.id != null) { const h = humanos.get(f.quem.id) ?? { nome: f.quem.nome, n: 0 }; h.n++; humanos.set(f.quem.id, h) } }
  const quem: OpcaoDeFiltro<string>[] = [
    { valor: 'todos', rotulo: 'Todos', n: paraQuem.length },
    ...[...humanos.entries()].sort((a, b) => a[1].nome.localeCompare(b[1].nome, 'pt-BR')).map(([id, h]) => ({ valor: `u:${id}`, rotulo: h.nome, n: h.n })),
    ...(sistema > 0 || fil.quem === 'sistema' ? [{ valor: 'sistema', rotulo: 'Sistema (automático)', n: sistema }] : []),
  ]
  const paraTipo = fatos.filter((f) => passaNosFiltros(f, fil, agora, 'tipo'))
  const tipo: OpcaoDeFiltro<TipoDeFato | 'todos'>[] = [
    { valor: 'todos', rotulo: 'Todos', n: paraTipo.length },
    ...TIPOS_DE_FATO.map((t) => ({ valor: t as TipoDeFato, rotulo: ROTULO_TIPO_DE_FATO[t], n: paraTipo.filter((f) => f.tipo === t).length })).filter((o) => o.n > 0 || fil.tipo === o.valor),
  ]
  const paraPessoa = fatos.filter((f) => passaNosFiltros(f, fil, agora, 'pessoa'))
  const pessoas = new Map<number, { nome: string; n: number }>()
  for (const f of paraPessoa) {
    const ids = new Map<number, string>()
    if (f.pessoaId != null && f.pessoa) ids.set(f.pessoaId, f.pessoa)
    for (const i of f.agrupadoDe) if (i.links.pessoaId != null && i.pessoa) ids.set(i.links.pessoaId, i.pessoa)
    for (const [id, nome] of ids) { const p = pessoas.get(id) ?? { nome, n: 0 }; p.n++; pessoas.set(id, p) }
  }
  const pessoa: OpcaoDeFiltro<number | 'todas'>[] = [
    { valor: 'todas', rotulo: 'Todas', n: paraPessoa.length },
    ...[...pessoas.entries()].sort((a, b) => a[1].nome.localeCompare(b[1].nome, 'pt-BR')).map(([id, p]) => ({ valor: id, rotulo: p.nome, n: p.n })),
  ]

  const chips: ChipDeFiltro[] = []
  if (fil.periodo !== 'todo') chips.push({ chave: 'periodo', rotulo: fil.periodo === 'intervalo' ? `${fil.de ? fDataCompleta.format(new Date(`${fil.de}T12:00:00-03:00`)) : '…'} a ${fil.ate ? fDataCompleta.format(new Date(`${fil.ate}T12:00:00-03:00`)) : '…'}` : ROTULO_PERIODO[fil.periodo] })
  if (fil.busca.trim()) chips.push({ chave: 'busca', rotulo: `“${fil.busca.trim()}”` })
  if (fil.quem !== 'todos') chips.push({ chave: 'quem', rotulo: quem.find((o) => o.valor === fil.quem)?.rotulo ?? 'Quem' })
  if (fil.tipo !== 'todos') chips.push({ chave: 'tipo', rotulo: ROTULO_TIPO_DE_FATO[fil.tipo] })
  if (fil.pessoaId !== 'todas') chips.push({ chave: 'pessoa', rotulo: pessoa.find((o) => o.valor === fil.pessoaId)?.rotulo ?? 'Pessoa' })
  if (fil.ocultarAutomaticos) chips.push({ chave: 'automaticos', rotulo: 'Ocultar automáticos' })

  const autores = new Map<number, string>()
  for (const f of semOcultar) if (f.quem.tipo === 'humano' && f.quem.id != null) autores.set(f.quem.id, f.quem.nome)
  const ultimo = semOcultar.reduce<FatoDoHistorico | null>((m, f) => (!m || f.quando > m.quando ? f : m), null)
  const rodape: RodapeDoHistorico = {
    fatosNoPeriodo: semOcultar.length,
    pessoasQueAtuaram: [...autores.values()].sort((a, b) => a.localeCompare(b, 'pt-BR')),
    cancelamentos: semOcultar.filter((f) => f.subtipo === 'cancelada').reduce((s, f) => s + f.quantidade, 0),
    certidoesValidadas: semOcultar.filter((f) => f.subtipo === 'validada').reduce((s, f) => s + f.quantidade, 0),
    ultimoFato: ultimo ? rotuloDoMomento(ultimo.quando, agora) : null,
  }

  return { visiveis, mostrando: visiveis.length, total: fatos.length, dias, automaticosOcultos: fil.ocultarAutomaticos ? semOcultar.filter((f) => f.automatico).length : 0, opcoes: { quem, tipo, pessoa }, chips, rodape }
}

// ─── QUERY STRING (a MESMA leitura para a tela, o CSV e a rota) ─────────────
export function filtrosDaQuery(q: URLSearchParams): FiltrosDoHistorico {
  const periodo = q.get('periodo') as PeriodoDoHistorico | null
  const tipo = q.get('tipo')
  const pessoa = Number(q.get('pessoaId'))
  const dia = (v: string | null) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null)
  return {
    busca: (q.get('busca') ?? '').slice(0, 200),
    periodo: periodo && periodo in ROTULO_PERIODO ? periodo : 'todo',
    de: dia(q.get('de')), ate: dia(q.get('ate')),
    quem: /^(todos|sistema|u:\d+)$/.test(q.get('quem') ?? '') ? (q.get('quem') as string) : 'todos',
    tipo: tipo && (TIPOS_DE_FATO as readonly string[]).includes(tipo) ? (tipo as TipoDeFato) : 'todos',
    pessoaId: Number.isInteger(pessoa) && pessoa > 0 ? pessoa : 'todas',
    ocultarAutomaticos: q.get('ocultarAutomaticos') === '1',
  }
}

export function queryDosFiltros(f: FiltrosDoHistorico): URLSearchParams {
  const q = new URLSearchParams()
  if (f.busca.trim()) q.set('busca', f.busca.trim())
  q.set('periodo', f.periodo)
  if (f.periodo === 'intervalo') { if (f.de) q.set('de', f.de); if (f.ate) q.set('ate', f.ate) }
  if (f.quem !== 'todos') q.set('quem', f.quem)
  if (f.tipo !== 'todos') q.set('tipo', f.tipo)
  if (f.pessoaId !== 'todas') q.set('pessoaId', String(f.pessoaId))
  if (f.ocultarAutomaticos) q.set('ocultarAutomaticos', '1')
  return q
}
