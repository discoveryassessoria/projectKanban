// lib/operacional/torre-processo-puro.ts
// ============================================================================
// O DETALHE DO PROCESSO (Torre nova, frente H, 01/10/2026) — a parte PURA: textos, ordenações, filtros, agrupamentos e a
// resolução de @menções. Sem banco, sem relógio (`agora` entra por parâmetro), importável pela TELA e pelo servidor.
//
// Nenhuma regra de negócio mora aqui que já exista em outro lugar: o risco da tarefa é `nivelDeRisco` (torre-filtros), a bola é
// `torre-bola`, o texto do prazo é `textoPrazoDaTarefa`, o rótulo do status é o mapa único `ROTULO_STATUS`. Aqui só se
// ORGANIZA o que essas fontes já disseram para o desenho do protótipo (`prototipo-torre/torre-de-controle.html`, tela do Processo).
// ============================================================================
import { FUSO_OPERACIONAL, diaOperacional, diasEntreDiasOperacionais } from './tempo-operacional'
import { ROTULO_STATUS } from '@/src/lib/home/rotulo-status-tarefa'
import { diaMesDoPrazo, textoPrazoDaTarefa } from '@/src/lib/tarefa/texto-prazo'
import { BOLA_NOSSA, type BolaCom } from './torre-bola'
import { ordenarCertidoesDaFamilia, type ChaveDaCertidao } from './ordem-certidoes'

// ─── DATAS ───────────────────────────────────────────────────────────────────

const hora = (d: Date): string => d.toLocaleTimeString('pt-BR', { timeZone: FUSO_OPERACIONAL, hour: '2-digit', minute: '2-digit', hour12: false })
const diaMes = (d: Date): string => d.toLocaleDateString('pt-BR', { timeZone: FUSO_OPERACIONAL, day: '2-digit', month: '2-digit' })

/** "Hoje 12:27" · "Ontem 18:00" · "29/09 14:16" (fuso operacional). `minusculo` → "hoje 12:27" · "ontem 15:30". `null`/inválido → "—". */
export function rotuloQuando(iso: string | null | undefined, agora: Date, minusculo = false): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  const dias = diasEntreDiasOperacionais(agora, d)
  const baixo = (s: string) => (minusculo ? s.toLowerCase() : s)
  if (dias === 0) return `${baixo('Hoje')} ${hora(d)}`
  if (dias === 1) return `${baixo('Ontem')} ${hora(d)}`
  return `${diaMes(d)} ${hora(d)}`
}

/** "hoje" · "ontem" · "29/09" — para frases ("cancelada hoje", "não exigida desde 29/09"). */
export function rotuloDia(iso: string | null | undefined, agora: Date): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  const dias = diasEntreDiasOperacionais(agora, d)
  return dias === 0 ? 'hoje' : dias === 1 ? 'ontem' : diaMes(d)
}

/** "29/09" — dia/mês no fuso operacional. */
export const rotuloDiaMes = (iso: string | null | undefined): string => (iso ? diaMesDoPrazo(iso) ?? '—' : '—')

const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
/** "abr/2027" (mês/ano no fuso operacional). */
export function rotuloMesAno(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  const [ano, mes] = diaOperacional(d).split('-')
  return `${MESES[Number(mes) - 1]}/${ano}`
}

/** "7,1 meses" (30 dias = 1 mês, 1 casa decimal, vírgula); abaixo de 30 dias → "N dias". */
export function rotuloDuracaoMedia(dias: number): string {
  if (!(dias >= 0)) return '—'
  if (dias < 30) return `${Math.round(dias)} ${Math.round(dias) === 1 ? 'dia' : 'dias'}`
  return `${(dias / 30).toFixed(1).replace('.', ',')} meses`
}

// ─── STATUS DA LINHA DA TABELA ───────────────────────────────────────────────

export type ChaveDeStatus = 'A_INICIAR' | 'EM_ANDAMENTO' | 'AGUARDANDO_TERCEIROS' | 'AGUARDANDO_CLIENTE' | 'BLOQUEADA' | 'CONCLUIDA' | 'CANCELADA' | 'NAO_EXIGIDA'

/** O status da tarefa em português — o mapa único `ROTULO_STATUS`; só "Aguardando terceiros" é o termo oficial da Torre. */
export function rotuloDoStatus(statusTarefa: string): string {
  if (statusTarefa === 'AGUARDANDO_TERCEIRO') return 'Aguardando terceiros'
  return ROTULO_STATUS[statusTarefa] ?? statusTarefa
}

export function chaveDoStatus(statusTarefa: string): ChaveDeStatus {
  switch (statusTarefa) {
    case 'NAO_INICIADA': return 'A_INICIAR'
    case 'EM_ANDAMENTO': return 'EM_ANDAMENTO'
    case 'AGUARDANDO_TERCEIRO': return 'AGUARDANDO_TERCEIROS'
    case 'AGUARDANDO_CLIENTE': return 'AGUARDANDO_CLIENTE'
    case 'BLOQUEADA': return 'BLOQUEADA'
    case 'CONCLUIDO_RECEBIDO': case 'CONCLUIDO_NAO_POSSUI': return 'CONCLUIDA'
    default: return 'A_INICIAR'
  }
}

/** As opções do select "Status" — as do protótipo + as duas que o sistema real tem e o exemplo não tinha. */
export type FiltroDeStatusDaTabela = 'ATIVAS' | 'TODOS' | ChaveDeStatus | 'ENCERRADAS'
/** O nome do bloco (e do filtro) das certidões que deixaram de ser trabalho. */
export const ROTULO_ENCERRADAS = 'Cancelada / não exigida'
export const OPCOES_DE_STATUS: ReadonlyArray<{ valor: FiltroDeStatusDaTabela; rotulo: string }> = [
  { valor: 'ATIVAS', rotulo: 'Ativas' },
  { valor: 'TODOS', rotulo: 'Ativas + canceladas / não exigidas' },
  { valor: 'A_INICIAR', rotulo: 'A iniciar' },
  { valor: 'EM_ANDAMENTO', rotulo: 'Em andamento' },
  { valor: 'AGUARDANDO_TERCEIROS', rotulo: 'Aguardando terceiros' },
  { valor: 'AGUARDANDO_CLIENTE', rotulo: 'Aguardando cliente' },
  { valor: 'BLOQUEADA', rotulo: 'Bloqueada' },
  { valor: 'CONCLUIDA', rotulo: 'Concluída' },
  { valor: 'ENCERRADAS', rotulo: ROTULO_ENCERRADAS },
]
// A ORDEM da tabela NÃO é opção: é a regra fixa das certidões (`ordem-certidoes.ts`). Prazo e status nunca reordenam certidões da família.

// ─── A LINHA DA TABELA "CERTIDÕES DA FASE ATUAL" ─────────────────────────────

/** Uma linha da tabela — aberta, concluída, cancelada ou não exigida. Montada no servidor, só desenhada na tela. */
export interface LinhaDaTabela {
  chave: string
  tarefaId: number | null
  documentoId: number | null
  tipo: 'ABERTA' | 'CONCLUIDA' | 'CANCELADA' | 'NAO_EXIGIDA'
  /** "Certidão de nascimento". */
  titulo: string
  pessoaId: number | null
  pessoa: string | null
  /** "G1 bisavó" (geração calculada + posição na árvore); `null` = a pessoa não tem posição derivável. */
  geracao: string | null
  /** A GERAÇÃO calculada (G1 = ancestral que origina o direito) — a chave de geração da regra fixa de ordem. `null` vai para o fim. */
  geracaoNum: number | null
  /** A pessoa está na linha reta? (`null`/`false` = fora da linha). */
  linhaReta: boolean | null
  /** Data de nascimento da pessoa (ISO). `null` vai depois de quem tem. */
  pessoaNascimento: string | null
  passo: { rotulo: string; ordem: number; total: number } | null
  status: ChaveDeStatus | 'CANCELADA' | 'NAO_EXIGIDA'
  statusRotulo: string
  responsavelId: number | null
  responsavelNome: string | null
  iniciouEm: string | null
  concluidaEm: string | null
  dataPrazo: string | null
  rotuloDoPrazo: string
  /** Tom do prazo e do nome: o MESMO nível de risco da aba Tarefas (`nivelDeRisco`). */
  risco: 'critico' | 'atencao' | 'ritmo' | null
  atrasada: boolean
  bola: BolaCom | null
  /** "cancelada hoje 12:15 por Marco Rovatti · Documento não necessário" (já redigido) — só para as canceladas / não exigidas. */
  encerramentoTexto: string | null
  /** Motivo curto para o link "Motivo" — só para as canceladas / não exigidas. */
  motivoTexto: string | null
  /** Pode reabrir pela porta canônica (cancelada por decisão humana). */
  reabrivel: boolean
  podeAtribuir: boolean
  /** A FASE da tarefa (a lista do processo mostra as abertas de TODAS as fases, agrupadas da mais antiga para a mais nova). */
  fase: { key: string | null; label: string | null; ordem: number }
  /** `true` = certidão inativa que NÃO tem tarefa cancelada (a árvore deixou de exigir): fora da conta das "canceladas" da aba Tarefas. */
  semTarefa?: boolean
}

/** A chave da regra fixa de ordem das certidões para uma linha desta tabela. */
export const chaveDaLinhaDaTabela = (l: LinhaDaTabela): ChaveDaCertidao => ({
  geracao: l.geracaoNum, linhaReta: l.linhaReta, pessoaNascimento: l.pessoaNascimento, pessoaId: l.pessoaId,
  titulo: l.titulo, desempate: l.tarefaId ?? l.documentoId ?? 0,
})

/** As pessoas que aparecem na tabela, para o select "Pessoa" (distintas, na ordem da regra fixa: geração, linha reta, nascimento). */
export function pessoasDaTabela(linhas: LinhaDaTabela[]): Array<{ id: number; nome: string }> {
  const primeira = new Map<number, LinhaDaTabela>()
  for (const l of linhas) if (l.pessoaId != null && l.pessoa && !primeira.has(l.pessoaId)) primeira.set(l.pessoaId, l)
  return ordenarCertidoesDaFamilia([...primeira.values()], chaveDaLinhaDaTabela).map((l) => ({ id: l.pessoaId!, nome: l.pessoa! }))
}

/**
 * Filtra por pessoa e status e ordena. O PADRÃO é "ATIVAS" (só o que é trabalho). Canceladas / não exigidas só aparecem em
 * "Ativas + canceladas / não exigidas" (no fim, riscadas) e em "Cancelada / não exigida" (só elas).
 */
export function filtrarEOrdenar(
  linhas: LinhaDaTabela[], f: { pessoaId: number | null; status: FiltroDeStatusDaTabela },
): LinhaDaTabela[] {
  const filtradas = linhas
    .filter((l) => (f.pessoaId == null ? true : l.pessoaId === f.pessoaId))
    .filter((l) => {
      if (f.status === 'TODOS') return true
      if (f.status === 'ATIVAS') return l.tipo === 'ABERTA' || l.tipo === 'CONCLUIDA'
      if (f.status === 'ENCERRADAS') return l.tipo === 'CANCELADA' || l.tipo === 'NAO_EXIGIDA'
      return l.status === f.status
    })
  // GRUPOS POR FASE, a mais antiga primeiro (é ela que trava as seguintes); dentro de cada grupo, UMA família (o processo): a regra fixa
  // das certidões e nada mais — nem o status (cancelada no fim) nem o prazo reordenam.
  const porFase = new Map<number, LinhaDaTabela[]>()
  for (const l of filtradas) { const o = l.fase?.ordem ?? 9999; const g = porFase.get(o) ?? []; g.push(l); porFase.set(o, g) }
  return [...porFase.entries()].sort((a, b) => a[0] - b[0]).flatMap(([, g]) => ordenarCertidoesDaFamilia(g, chaveDaLinhaDaTabela))
}

/** Quantas linhas contam por padrão: as que são trabalho (abertas + concluídas). Canceladas / não exigidas não contam. */
export const totalDaFase = (linhas: LinhaDaTabela[]): number => linhas.filter((l) => l.tipo === 'ABERTA' || l.tipo === 'CONCLUIDA').length

const ehEncerrada = (l: LinhaDaTabela): boolean => l.tipo === 'CANCELADA' || l.tipo === 'NAO_EXIGIDA'

/**
 * O rótulo do cartão: "Certidões da fase atual" quando TUDO é certidão; "Tarefas da fase atual" quando há tarefa de outro tipo (Análise,
 * Tradução…). O número é SEMPRE o das linhas mostradas (`mostradas`; sem ele, as ativas — o padrão). Quando a lista inclui canceladas /
 * não exigidas, o título diz quantas são: "· 19 (12 ativas + 7 canceladas / não exigidas)".
 */
export function tituloDaTabela(linhas: LinhaDaTabela[], ehCertidao: (l: LinhaDaTabela) => boolean, mostradas?: LinhaDaTabela[]): string {
  const trabalho = linhas.filter((l) => !ehEncerrada(l))
  const soCertidoes = trabalho.length > 0 && trabalho.every(ehCertidao)
  const lista = mostradas ?? trabalho
  const enc = lista.filter(ehEncerrada).length
  const ativas = lista.length - enc
  const detalhe = enc === 0 ? '' : ativas === 0 ? ` (${ROTULO_ENCERRADAS.toLowerCase()})` : ` (${ativas} ${ativas === 1 ? 'ativa' : 'ativas'} + ${enc} ${ROTULO_ENCERRADAS.toLowerCase()})`
  return `${soCertidoes ? 'Certidões abertas' : 'Tarefas abertas'} do processo · ${lista.length}${detalhe}`
}

// ─── LINHA-RESUMO ("+ 5 certidões iguais a estas") ───────────────────────────

export const LINHAS_DETALHADAS = 7

const assinatura = (l: LinhaDaTabela): string =>
  [l.passo ? `${l.passo.rotulo}/${l.passo.ordem}/${l.passo.total}` : '', l.status, l.responsavelId ?? '', l.dataPrazo ? diaMesDoPrazo(l.dataPrazo) : '', l.bola ?? ''].join('|')

export interface ResumoDasIguais { visiveis: LinhaDaTabela[]; ocultas: LinhaDaTabela[]; nomes: string[]; descricao: string }

/**
 * Como o protótipo: mostra as 7 primeiras e UMA linha-resumo para as que são IGUAIS a elas (mesmo passo, status, responsável,
 * prazo e bola). Só colapsa quando TODAS as linhas de trabalho são iguais entre si e passam de 7 — senão mostra tudo (esconder
 * linha diferente seria esconder informação). `ocultas` vazio = nada a resumir.
 */
export function resumirIguais(trabalho: LinhaDaTabela[], descricaoDe: (l: LinhaDaTabela) => string): ResumoDasIguais {
  if (trabalho.length <= LINHAS_DETALHADAS) return { visiveis: trabalho, ocultas: [], nomes: [], descricao: '' }
  const todasIguais = new Set(trabalho.map(assinatura)).size === 1
  if (!todasIguais) return { visiveis: trabalho, ocultas: [], nomes: [], descricao: '' }
  const ocultas = trabalho.slice(LINHAS_DETALHADAS)
  const nomes: string[] = []
  for (const l of ocultas) {
    const n = (l.pessoa ?? '').trim().split(/\s+/)[0]
    if (n && !nomes.includes(n)) nomes.push(n)
  }
  return { visiveis: trabalho.slice(0, LINHAS_DETALHADAS), ocultas, nomes, descricao: descricaoDe(trabalho[0]) }
}

// ─── CABEÇALHO ───────────────────────────────────────────────────────────────

/** Os 4 níveis da regra única `torre-risco.ts` (repetidos aqui só para este módulo não importar nada de servidor). */
export type NivelDeRiscoDoProcesso = 'no_ritmo' | 'atencao' | 'parado' | 'critico'

/**
 * O selo do cabeçalho: "Atenção · 12 sem responsável". O NÍVEL é o do risco do processo (a regra única `torre-risco.ts`); a RAZÃO é o fato
 * mais grave que a tela já conhece (vencidas > sem responsável > aguardando terceiros). Pausado vence tudo ("Pausado").
 */
export function seloDoCabecalho(a: {
  pausado: boolean; risco: NivelDeRiscoDoProcesso | null; numeros: { vencidas: number; semResponsavel: number; comCartorio: number }
}): { rotulo: string; tom: 'cinza' | 'ambar' | 'vermelho' | 'verde' } {
  if (a.pausado) return { rotulo: 'Pausado', tom: 'cinza' }
  const razao = a.numeros.vencidas > 0
    ? `${a.numeros.vencidas} ${a.numeros.vencidas === 1 ? 'vencida' : 'vencidas'}`
    : a.numeros.semResponsavel > 0 ? `${a.numeros.semResponsavel} sem responsável` : null
  if (a.risco === 'critico') return { rotulo: razao ? `Crítico · ${razao}` : 'Crítico', tom: 'vermelho' }
  if (a.risco === 'parado') return { rotulo: razao ? `Parado · ${razao}` : 'Parado', tom: 'vermelho' }
  if (a.risco === 'atencao') return { rotulo: razao ? `Atenção · ${razao}` : 'Atenção', tom: 'ambar' }
  return { rotulo: 'No ritmo', tom: 'verde' }
}

// ─── PRÓXIMA AÇÃO (DERIVADA DAS TAREFAS ABERTAS) ─────────────────────────────

/** O subconjunto da linha da Torre que as derivações dos cartões leem. */
export interface LinhaParaDerivar {
  taskId: number
  titulo: string
  documentoId: number | null
  pessoaNome: string | null
  statusTarefa: string
  aIniciar: boolean
  estadoOperacao: 'FILA' | 'AGUARDANDO' | 'CONCLUIDA'
  responsavelId: number | null
  responsavelNome: string | null
  dataPrazo: string | null
  rotuloDoPrazo: string
  diasParaPrazo: number | null
  atrasada: boolean
  faseMacroKey: string | null
  passoAtual: { ordem: number; total: number } | null
  passoCorrente: { chave: string; label: string } | null
  bolaCom: BolaCom
  terceiroNome: string | null
}

const maisCedo = <T extends LinhaParaDerivar>(ls: T[]): T =>
  [...ls].sort((a, b) => (a.dataPrazo ? Date.parse(a.dataPrazo) : Infinity) - (b.dataPrazo ? Date.parse(b.dataPrazo) : Infinity) || a.taskId - b.taskId)[0]

/**
 * O cartão "Próxima ação · obrigatória": a MESMA derivação da aba Processos (`torre-proxima-acao.ts`, decisão 3 do PROGRESSO.md —
 * lida das tarefas abertas da fase, nunca digitada). Aqui só se REDIGE o cartão do protótipo:
 *   título   "Distribuir as 12 certidões de Emissão documental" (a ação + a fase, quando a ação é distribuir);
 *   detalhe  "responsável: nenhum · prazo: hoje · por isso este processo está em "Precisa de você"".
 */
export function cartaoDaProximaAcao(
  a: { texto: string; tipo: string; urgencia: 'atrasada' | 'vence_em_breve' | null; responsavelNome: string | null },
  prazoTexto: string | null, faseLabel: string | null, noPrecisaDeVoce: boolean,
): { titulo: string; detalhe: string; urgente: boolean } {
  const titulo = a.tipo === 'distribuir' && faseLabel && !a.texto.includes(faseLabel) && /^Distribuir as \d+ /.test(a.texto) ? `${a.texto} de ${faseLabel}` : a.texto
  const prazo = prazoTexto ?? 'sem prazo'
  return {
    titulo,
    detalhe: `responsável: ${a.responsavelNome ?? 'nenhum'} · prazo: ${prazo}${noPrecisaDeVoce ? ' · por isso este processo está em "Precisa de você"' : ''}`,
    urgente: a.tipo === 'distribuir' || a.urgencia === 'atrasada',
  }
}

// ─── OS CINCO CARTÕES ────────────────────────────────────────────────────────

export interface CartaoSimples { rotulo: string; titulo: string; sub: string; tom: 'normal' | 'vermelho' | 'ambar' }

const plural = (n: number, um: string, varios: string): string => (n === 1 ? um : varios)
const nomeDoEstado = (l: LinhaParaDerivar): string =>
  l.statusTarefa === 'BLOQUEADA' ? 'bloqueada' : l.statusTarefa === 'AGUARDANDO_CLIENTE' ? 'aguardando cliente'
    : l.estadoOperacao === 'AGUARDANDO' ? 'aguardando terceiros' : l.aIniciar ? 'a iniciar' : 'em andamento'

export function cartoesDaFase<L extends LinhaParaDerivar>(a: {
  /** Tarefas ABERTAS da fase atual. */
  linhas: L[]
  encerradas: { canceladas: number; naoExigidas: number }
  /** O nível de risco de cada tarefa (a mesma `nivelDeRisco` da aba Tarefas) — o chamador passa a função. */
  riscoDe: (l: L) => 'critico' | 'atencao' | 'ritmo'
  /**
   * O cartão "Cartórios" olha as CERTIDÕES da fase — abertas E concluídas, pelo órgão vinculado no DOCUMENTO. Sem isto ele só via as tarefas abertas
   * e dizia "Ainda não vinculados" mesmo com casamento e óbito já vinculados (caso Sanchez Dias, 06/10/2026). Sem a lista, vale o comportamento antigo.
   */
  certidoesDaFase?: Array<{ documentoId: number | null; terceiroNome: string | null }>
}): CartaoSimples[] {
  const ls = a.linhas
  const n = ls.length

  // PASSO ATUAL — o passo onde está a maioria das tarefas abertas.
  let passo: CartaoSimples
  if (n === 0) passo = { rotulo: 'Passo atual', titulo: '—', sub: 'nenhuma tarefa aberta nesta fase', tom: 'normal' }
  else {
    const por = new Map<string, LinhaParaDerivar[]>()
    for (const l of ls) por.set(l.passoCorrente?.label ?? '—', [...(por.get(l.passoCorrente?.label ?? '—') ?? []), l])
    const [rotulo, grupo] = [...por.entries()].sort((x, y) => y[1].length - x[1].length)[0]
    const estados = new Set(grupo.map(nomeDoEstado))
    // `passoAtual.ordem` da projeção = quantos passos já ficaram para trás; o passo em que está é o seguinte ("passo 1 de 4" = o primeiro).
    const posicao = grupo[0].passoAtual ? `passo ${Math.min(grupo[0].passoAtual.ordem + 1, grupo[0].passoAtual.total)} de ${grupo[0].passoAtual.total} · ` : ''
    const quantas = estados.size === 1 ? `${grupo.length} ${[...estados][0]}` : `${grupo.length} neste passo`
    const outros = por.size > 1 ? ` · +${n - grupo.length} em outros passos` : ''
    passo = { rotulo: 'Passo atual', titulo: rotulo, sub: `${posicao}${quantas}${outros}`, tom: 'normal' }
  }

  // COM QUEM
  const semDono = ls.filter((l) => l.responsavelId == null).length
  const comTerceiro = ls.filter((l) => l.responsavelId != null && l.bolaCom !== BOLA_NOSSA).length
  const equipe = n - semDono - comTerceiro
  const responsaveis = new Set(ls.filter((l) => l.responsavelId != null).map((l) => l.responsavelNome ?? ''))
  const comQuem: CartaoSimples = {
    rotulo: 'Com quem',
    titulo: n === 0 ? '—' : semDono === n ? 'Sem responsável' : responsaveis.size === 1 ? [...responsaveis][0] : `${responsaveis.size} pessoas`,
    sub: n === 0 ? 'nenhuma tarefa aberta nesta fase' : `${equipe} equipe · ${comTerceiro} ${plural(comTerceiro, 'terceiro', 'terceiros')} · ${semDono} sem dono`,
    tom: n > 0 && semDono === n ? 'vermelho' : 'normal',
  }

  // PRAZO — o da tarefa aberta de prazo mais cedo.
  let prazo: CartaoSimples
  const comPrazo = ls.filter((l) => l.dataPrazo)
  if (comPrazo.length === 0) prazo = { rotulo: 'Prazo', titulo: n === 0 ? '—' : 'Sem prazo', sub: n === 0 ? 'nenhuma tarefa aberta nesta fase' : 'nenhuma tarefa aberta tem prazo', tom: 'normal' }
  else {
    const cedo = maisCedo(comPrazo)
    const iguais = comPrazo.filter((l) => l.dataPrazo === cedo.dataPrazo).length
    const dias = cedo.diasParaPrazo
    const quando = dias == null ? '' : dias < 0 ? ` · atrasado há ${-dias} ${plural(-dias, 'dia', 'dias')}` : dias === 0 ? ' · vence hoje' : ` · faltam ${dias} ${plural(dias, 'dia', 'dias')}`
    const quantas = iguais === n ? `as ${n}` : `${iguais} de ${n}`
    prazo = {
      rotulo: 'Prazo',
      titulo: cedo.aIniciar && cedo.estadoOperacao !== 'AGUARDANDO' && !cedo.atrasada ? `Iniciar até ${diaMesDoPrazo(cedo.dataPrazo)}` : textoPrazoDaTarefa(cedo),
      sub: `${quantas}${quando}`,
      tom: cedo.atrasada ? 'vermelho' : a.riscoDe(cedo) === 'ritmo' ? 'normal' : 'ambar',
    }
  }

  // CARTÓRIOS — os órgãos vinculados às CERTIDÕES da fase (documento), abertas ou já concluídas: quantas têm órgão e quantas faltam.
  const certidoes = a.certidoesDaFase
    ? [...new Map(a.certidoesDaFase.filter((c) => c.documentoId != null).map((c) => [c.documentoId as number, c])).values()]
    : ls.map((l) => ({ documentoId: null as number | null, terceiroNome: l.terceiroNome }))
  const totalCert = certidoes.length
  const orgaos = [...new Set(certidoes.map((l) => l.terceiroNome).filter((x): x is string => !!x))]
  const comOrgao = certidoes.filter((l) => l.terceiroNome).length
  const faltam = totalCert - comOrgao
  const cartorios: CartaoSimples = totalCert === 0
    ? { rotulo: 'Cartórios', titulo: '—', sub: 'nenhuma certidão nesta fase', tom: 'normal' }
    : orgaos.length === 0
      ? { rotulo: 'Cartórios', titulo: 'Nenhum vinculado', sub: `${totalCert === 1 ? 'a certidão ainda não tem' : `as ${totalCert} certidões ainda não têm`} órgão vinculado`, tom: 'normal' }
      : {
          rotulo: 'Cartórios',
          titulo: orgaos.length <= 2 ? orgaos.join(' · ') : `${orgaos.slice(0, 2).join(' · ')} +${orgaos.length - 2}`,
          sub: faltam === 0 ? `${totalCert === 1 ? 'a certidão já está vinculada' : `as ${totalCert} já vinculadas`}` : `${comOrgao} de ${totalCert} vinculadas · ${faltam} ${faltam === 1 ? 'falta' : 'faltam'} vincular`,
          tom: 'normal',
        }

  // CANCELADA / NÃO EXIGIDA — `canceladas` = as tarefas canceladas do processo (a MESMA consulta e o MESMO número da aba Tarefas, L3);
  // `naoExigidas` = certidões inativas SEM tarefa (a árvore deixou de exigir), mostradas à parte e nunca somadas às canceladas.
  const totalFora = a.encerradas.canceladas + a.encerradas.naoExigidas
  const semTarefa = a.encerradas.naoExigidas > 0 ? `${a.encerradas.naoExigidas} ${plural(a.encerradas.naoExigidas, 'não exigida', 'não exigidas')} pela árvore (sem tarefa)` : null
  const fora: CartaoSimples = {
    rotulo: ROTULO_ENCERRADAS,
    titulo: totalFora === 0 ? 'Nenhuma' : a.encerradas.canceladas > 0 ? `${a.encerradas.canceladas} ${plural(a.encerradas.canceladas, 'cancelada', 'canceladas')}` : `${a.encerradas.naoExigidas} ${plural(a.encerradas.naoExigidas, 'não exigida', 'não exigidas')}`,
    sub: totalFora === 0 ? 'nada cancelado nem dispensado pela árvore' : a.encerradas.canceladas > 0 ? (semTarefa ?? 'todas com tarefa — as mesmas da aba Tarefas') : 'pela árvore (sem tarefa)',
    tom: 'normal',
  }
  return [passo, comQuem, prazo, cartorios, fora]
}

// ─── @MENÇÃO ─────────────────────────────────────────────────────────────────

export interface PessoaMencionavel { id: number; nome: string }

const semAcento = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

/**
 * Do texto digitado ("@Daniela, pode distribuir…") para o texto GRAVADO (`@[Daniela Brait](12)` — o formato que o motor de
 * comentários entende). Casa primeiro o NOME COMPLETO ("@Daniela Brait"), depois o PRIMEIRO NOME quando é único na equipe.
 * "@" sem pessoa correspondente fica como texto (não vira menção). PURO.
 */
export function resolverMencoes(texto: string, equipe: PessoaMencionavel[]): { texto: string; mencionados: PessoaMencionavel[] } {
  const mencionados: PessoaMencionavel[] = []
  const ordenadas = [...equipe].sort((a, b) => b.nome.length - a.nome.length)
  const primeiros = new Map<string, PessoaMencionavel[]>()
  for (const p of equipe) {
    const k = semAcento(p.nome.trim().split(/\s+/)[0])
    primeiros.set(k, [...(primeiros.get(k) ?? []), p])
  }
  const saida = texto.replace(/@(?!\[)([^\s@,;:!?()]+(?:\s+[^\s@,;:!?()]+)*)/g, (casado, resto: string) => {
    // 1. nome completo (o mais longo que abre o trecho)
    const k = semAcento(resto)
    for (const p of ordenadas) {
      const nome = semAcento(p.nome.trim())
      if (k === nome || k.startsWith(`${nome} `)) {
        if (!mencionados.some((m) => m.id === p.id)) mencionados.push(p)
        const consumido = p.nome.trim().split(/\s+/).length
        const sobra = resto.split(/\s+/).slice(consumido).join(' ')
        return `@[${p.nome}](${p.id})${sobra ? ` ${sobra}` : ''}`
      }
    }
    // 2. primeiro nome único
    const primeiraPalavra = resto.split(/\s+/)[0]
    const candidatos = primeiros.get(semAcento(primeiraPalavra)) ?? []
    if (candidatos.length === 1) {
      const p = candidatos[0]
      if (!mencionados.some((m) => m.id === p.id)) mencionados.push(p)
      const sobra = resto.split(/\s+/).slice(1).join(' ')
      return `@[${p.nome}](${p.id})${sobra ? ` ${sobra}` : ''}`
    }
    return casado
  })
  return { texto: saida, mencionados }
}

export interface PedacoDoComentario { tipo: 'texto' | 'mencao'; valor: string }

/** Quebra o texto gravado em pedaços para destacar as menções (`@[Nome](id)` → "@Nome" em destaque). */
export function pedacosDoComentario(texto: string): PedacoDoComentario[] {
  const partes: PedacoDoComentario[] = []
  let ultimo = 0
  for (const m of texto.matchAll(/@\[([^\]]+)\]\(\d+\)/g)) {
    const i = m.index ?? 0
    if (i > ultimo) partes.push({ tipo: 'texto', valor: texto.slice(ultimo, i) })
    partes.push({ tipo: 'mencao', valor: `@${m[1]}` })
    ultimo = i + m[0].length
  }
  if (ultimo < texto.length) partes.push({ tipo: 'texto', valor: texto.slice(ultimo) })
  return partes
}

/** As iniciais do avatar: "Marco Rovatti" → "MR". */
export function iniciaisDe(nome: string): string {
  return nome.trim().split(/\s+/).filter(Boolean).map((x) => x[0]).slice(0, 2).join('').toUpperCase() || '?'
}
