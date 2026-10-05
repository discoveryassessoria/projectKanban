// lib/operacional/terceiros-pedidos.ts
// ============================================================================
// TERCEIROS — a lista POR PEDIDO e o resumo POR TIPO de terceiro (Torre nova, frente G, 01/10/2026).
// PURO: sem Prisma, sem relógio (`agora` injetável), importável pela tela e pelo servidor/testes.
//
// GRAIN: PEDIDO = uma TAREFA que espera resposta de fora (`estadoOperacao = AGUARDANDO`) — certidão · pessoa · família.
// Nada é somado a Documento/Passo; a lista, os cartões e o botão "Cobrar todos os vencidos (N)" saem das MESMAS linhas.
//
// O QUE FECHA COM AS OUTRAS TELAS (uma definição só):
//   • "aguardando terceiros" (cartão 1) = `numeroDoKpi('cartorio')` — o MESMO número da Visão geral e da visão
//     "Aguardando terceiros" da aba Tarefas (aberta, COM responsável, esperando um terceiro). Os cartões 2–4 repartem
//     esse mesmo conjunto por `bolaCom` (cartórios + cliente + tradutor·juízo·consulado = cartão 1, sempre).
//   • A LISTA mostra TODOS os pedidos esperando resposta, inclusive os sem responsável (que a Visão geral conta em
//     "Sem responsável" por precedência): cobrar um terceiro não depende de a tarefa ter dono.
//   • "para cobrar hoje ou vencidas" = pedidos cuja data de cobrança é hoje ou já passou (`precisaCobrar`).
//
// NÃO EXISTE aqui ranking, média nem contagem comparativa por cartório. O agrupamento por órgão (`agruparPorOrgao`) serve
// só para cobrar junto o que está no mesmo lugar; o cabeçalho de cada grupo carrega o nome e a quantidade de pedidos.
// ============================================================================
import { diasPorExtenso } from './tempo-extenso'
import { diaOperacional, diasEntreDiasOperacionais, FUSO_OPERACIONAL } from './tempo-operacional'
import { numeroDoKpi, PREDICADO_DO_KPI, type LinhaParaKpi } from './torre-kpis'
import { ehCobravelVencido } from './torre-predicados'
import type { BolaCom } from './torre-bola'

/** O que a tela Terceiros precisa saber de uma linha da Torre (subconjunto de `LinhaTorre`). */
export interface LinhaParaTerceiros extends LinhaParaKpi {
  taskId: number
  titulo: string
  pessoaNome?: string | null
  casalNomes?: string | null
  familiaNome?: string | null
  processoNome?: string | null
  terceiroNome: string | null
  orgaoId: number | null
  totalCobrancas: number
  cobravelVencida: boolean
  bolaCom: BolaCom
  pedidaEm: string | null
  cobrarEm: string | null
}

/** É um PEDIDO esperando resposta de fora. A MESMA definição de "AGUARDANDO" do cartão "Aguardando terceiros". */
export const ehPedidoDeTerceiro = (l: Pick<LinhaParaKpi, 'estadoOperacao'>): boolean => l.estadoOperacao === 'AGUARDANDO'

// ─── QUANDO COBRAR ───────────────────────────────────────────────────────────────────────────────────────────────

export type TomDaCobranca = 'vencida' | 'hoje' | 'futura' | 'sem'
export interface QuandoCobrar {
  /** "ontem" · "hoje" · "há 3 d" · "05/10" · "—". */
  texto: string
  tom: TomDaCobranca
  /** Dias (civis, fuso da operação) até a data: −1 = ontem, 0 = hoje, 3 = daqui a 3 dias. `null` = sem data. */
  dias: number | null
}

/** "dd/mm" no fuso da operação. */
export function ddmm(iso: string): string {
  const [, m, d] = diaOperacional(new Date(iso)).split('-')
  return `${d}/${m}`
}

/** "25/09 10:12" — dia e hora de um contato, no fuso da operação (nunca o do navegador). */
export function ddmmHora(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  const hora = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: FUSO_OPERACIONAL })
  return `${ddmm(iso)} ${hora}`
}

/** O texto e o tom da coluna "Cobrar em" — ontem (vermelho), hoje (âmbar), data futura (cinza). Sem data → "—". */
export function quandoCobrar(cobrarEm: string | null, agora: Date): QuandoCobrar {
  if (!cobrarEm) return { texto: '—', tom: 'sem', dias: null }
  const alvo = new Date(cobrarEm)
  if (Number.isNaN(alvo.getTime())) return { texto: '—', tom: 'sem', dias: null }
  const dias = diasEntreDiasOperacionais(alvo, agora)
  if (dias === 0) return { texto: 'hoje', tom: 'hoje', dias }
  if (dias === -1) return { texto: 'ontem', tom: 'vencida', dias }
  if (dias < -1) return { texto: `há ${diasPorExtenso(-dias)}`, tom: 'vencida', dias }
  return { texto: ddmm(cobrarEm), tom: 'futura', dias }
}

/**
 * PRECISA COBRAR HOJE OU JÁ DEVIA: a data de cobrança é hoje ou passou, OU o acompanhamento do passo já venceu
 * (`cobravelVencida` — o predicado do botão da Operação e do cartão "Cobranças a fazer"). Genealogia fica de fora
 * (lá o "terceiro" é o trabalho de localizar, não um cartório a cobrar). Só vale para pedido.
 */
export function precisaCobrar(l: Pick<LinhaParaTerceiros, 'estadoOperacao' | 'faseMacroKey' | 'cobravelVencida' | 'cobrarEm'>, agora: Date): boolean {
  return ehPedidoDeTerceiro(l) && ehCobravelVencido({ ...l, acompanhamentoVencido: l.cobravelVencida }, agora)
}

// ─── A LINHA DO PEDIDO ───────────────────────────────────────────────────────────────────────────────────────────

/** "52 d" — dias civis desde o pedido. Sem pedido registrado → "—" (registro antigo não é preenchido por suposição). */
export function pedidaHa(pedidaEm: string | null, agora: Date): string {
  if (!pedidaEm) return '—'
  const d = new Date(pedidaEm)
  if (Number.isNaN(d.getTime())) return '—'
  return diasPorExtenso(Math.max(0, diasEntreDiasOperacionais(agora, d)))
}

/** "nenhuma" · "1 cobrança" · "2 cobranças". */
export const cobrancasTexto = (n: number): string => (n <= 0 ? 'nenhuma' : n === 1 ? '1 cobrança' : `${n} cobranças`)

/** Só o TIPO da certidão ("Certidão de óbito"): o título vem pronto como "{Tipo} - Inteiro Teor · {Pessoa}". */
export function certidaoDe(titulo: string): string {
  return titulo.split(' · ')[0].replace(/\s*-\s*Inteiro Teor\s*$/i, '').trim()
}

export interface PedidoDeTerceiro {
  taskId: number
  certidao: string
  /** "Giuseppe e Ana Bertolucci" — o casal quando a certidão é de uma união; senão a pessoa. */
  pessoa: string
  familia: string
  /** O órgão a quem o pedido foi feito (cadastro de órgãos). `null` = a tarefa não tem órgão vinculado. */
  orgaoId: number | null
  orgao: string | null
  cobrancas: string
  pedidaHa: string
  cobrarEm: QuandoCobrar
  /** Botão "Cobrar" (marinho) em vez de "Ver": a data de cobrança é hoje/ontem ou já venceu. */
  cobrar: boolean
  processoId: number | null
  escalada: boolean
  bolaCom: BolaCom
}

/**
 * Os pedidos esperando resposta. A ORDEM é a da urgência de cobrar — não é um controle da tela (não há ordenação nem filtro):
 * primeiro quem tem a data de cobrança mais antiga (vencidos antes de hoje, hoje antes do futuro); no mesmo dia, o pedido mais
 * antigo primeiro; sem data de cobrança por último. Empate final pelo id da tarefa (estável).
 */
export function pedidosDeTerceiros(linhas: LinhaParaTerceiros[], agora: Date): PedidoDeTerceiro[] {
  const doPedido = linhas.filter(ehPedidoDeTerceiro).map((l) => {
    const cobrarEm = quandoCobrar(l.cobrarEm, agora)
    const pedido: PedidoDeTerceiro = {
      taskId: l.taskId,
      certidao: certidaoDe(l.titulo),
      pessoa: l.casalNomes ?? l.pessoaNome ?? '—',
      familia: l.familiaNome ?? l.processoNome ?? '—',
      orgaoId: l.orgaoId,
      orgao: l.terceiroNome,
      cobrancas: cobrancasTexto(l.totalCobrancas),
      pedidaHa: pedidaHa(l.pedidaEm, agora),
      cobrarEm,
      cobrar: precisaCobrar(l, agora),
      processoId: l.processoId,
      escalada: l.escalada,
      bolaCom: l.bolaCom,
    }
    return { pedido, dia: cobrarEm.dias, pedidaEm: l.pedidaEm ? Date.parse(l.pedidaEm) : Number.POSITIVE_INFINITY }
  })
  doPedido.sort((a, b) => {
    const da = a.dia ?? Number.POSITIVE_INFINITY, db = b.dia ?? Number.POSITIVE_INFINITY
    if (da !== db) return da < db ? -1 : 1
    if (a.pedidaEm !== b.pedidaEm) return a.pedidaEm < b.pedidaEm ? -1 : 1
    return a.pedido.taskId - b.pedido.taskId
  })
  return doPedido.map((x) => x.pedido)
}

// ─── AGRUPADO POR CARTÓRIO (só para cobrar junto) ────────────────────────────────────────────────────────────────

export const SEM_ORGAO = 'Sem órgão vinculado'

export interface GrupoDeOrgao {
  orgaoId: number | null
  /** Nome do órgão (ou `SEM_ORGAO`). */
  nome: string
  pedidos: PedidoDeTerceiro[]
}

/** "1 pedido(s) · cobrança registrada em cada certidão" — o subtítulo do cabeçalho de cada grupo. */
export const subtituloDoGrupo = (n: number): string => `${n} pedido(s) · cobrança registrada em cada certidão`

/**
 * Ordena por nome do órgão e agrupa. SEM números comparativos: o grupo só diz quantos pedidos tem, para cobrar junto.
 * Mesma ordem em todo ambiente (`localeCompare` em pt-BR); pedidos sem órgão vão para o fim, em grupo próprio.
 */
export function agruparPorOrgao(pedidos: PedidoDeTerceiro[]): GrupoDeOrgao[] {
  const por = new Map<string, GrupoDeOrgao>()
  for (const p of pedidos) {
    const chave = p.orgaoId != null ? `o${p.orgaoId}` : 'sem'
    const g = por.get(chave) ?? { orgaoId: p.orgaoId, nome: p.orgao ?? SEM_ORGAO, pedidos: [] }
    g.pedidos.push(p)
    por.set(chave, g)
  }
  return [...por.values()].sort((a, b) => {
    if ((a.orgaoId == null) !== (b.orgaoId == null)) return a.orgaoId == null ? 1 : -1
    return a.nome.localeCompare(b.nome, 'pt-BR')
  })
}

// ─── OS SEIS CARTÕES ─────────────────────────────────────────────────────────────────────────────────────────────

export interface ResumoDeTerceiros {
  /** = `numeroDoKpi('cartorio')`: o "Aguardando terceiros" da Visão geral e da aba Tarefas. */
  aguardando: number
  comCartorios: number
  comOCliente: number
  tradutora: number
  juizo: number
  consulado: number
  /** Pedidos com data de cobrança hoje ou vencida — também o N de "Cobrar todos os vencidos (N)". */
  paraCobrar: number
  /** Pedidos escalados (sem resposta após 2 cobranças — a régua do cadastro). */
  escaladas: number
}

/** Os cartões da tela. Os cartões 2–4 repartem EXATAMENTE o cartão 1 (`comCartorios + comOCliente + tradutora + juizo + consulado = aguardando`). */
export function resumoDeTerceiros(linhas: LinhaParaTerceiros[], agora: Date): ResumoDeTerceiros {
  const doCartao = linhas.filter((l) => PREDICADO_DO_KPI.cartorio!(l, agora))
  const n = (b: BolaCom) => doCartao.filter((l) => l.bolaCom === b).length
  const pedidos = linhas.filter(ehPedidoDeTerceiro)
  return {
    aguardando: numeroDoKpi('cartorio', linhas, agora),
    comCartorios: n('Cartório'), comOCliente: n('Cliente'), tradutora: n('Tradutor'), juizo: n('Juízo'), consulado: n('Consulado'),
    paraCobrar: pedidos.filter((l) => precisaCobrar(l, agora)).length,
    escaladas: pedidos.filter((l) => l.escalada).length,
  }
}

/** Os ids dos pedidos que "Cobrar todos os vencidos" cobra — o conjunto cujo tamanho é `paraCobrar`. */
export const idsParaCobrar = (linhas: LinhaParaTerceiros[], agora: Date): number[] =>
  linhas.filter((l) => precisaCobrar(l, agora)).map((l) => l.taskId)

/** O número de cartões formatado como no protótipo ("2.328"): separador de milhar pt-BR, sem depender do ambiente. */
export const milhar = (n: number): string => String(Math.trunc(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.')

/** Quantos cartórios (órgãos distintos) há num conjunto de pedidos — para o texto do modal "em N cartórios". */
export const cartoriosDistintos = (pedidos: Array<Pick<PedidoDeTerceiro, 'orgaoId'>>): number => new Set(pedidos.map((p) => p.orgaoId ?? 'sem')).size

// ─── O TEXTO DE UM CONTATO (modal "Contatos") ────────────────────────────────────────────────────────────────────

const VERBO_DO_CANAL: Record<string, string> = {
  EMAIL: 'cobrou por e-mail', TELEFONE: 'ligou', WHATSAPP: 'cobrou por WhatsApp', OFICIO: 'cobrou por ofício', PRESENCIAL: 'cobrou presencialmente',
}
const ROTULO_DO_RESULTADO: Record<string, string> = {
  SEM_RESPOSTA: 'sem resposta', CONFIRMOU_PEDIDO: 'confirmou o pedido', PEDIU_DOCUMENTO: 'pediu documento',
  EM_BUSCA: 'em busca', NAO_LOCALIZOU: 'não localizou', ENVIOU: 'enviou (ainda não recebido)',
}
const ROTULO_DO_CANAL_DO_PEDIDO: Record<string, string> = {
  CRC: 'CRC', ECARTORIO: 'e-cartório', EMAIL: 'e-mail', WHATSAPP: 'WhatsApp', BALCAO: 'balcão', COMUNE: 'Comune', CORREIOS: 'correios', CONSULADO: 'consulado',
}

/** "Priscila cobrou por e-mail · sem resposta" · `Daniela Brait ligou · "em busca no acervo"`. Nada é inventado: o que não existe não aparece. */
export function textoDoContato(c: { quem: string | null; canal: string; resultado: string; observacao: string | null }): string {
  const quem = c.quem ?? 'Alguém da equipe'
  const verbo = VERBO_DO_CANAL[c.canal] ?? `contatou por ${c.canal.toLowerCase()}`
  const resultado = ROTULO_DO_RESULTADO[c.resultado] ?? c.resultado.toLowerCase().replace(/_/g, ' ')
  const obs = c.observacao?.trim()
  return `${quem} ${verbo} · ${resultado}${obs ? ` · "${obs}"` : ''}`
}

/** "Daniela Brait enviou o pedido pelo CRC · protocolo 2026-0819-441" — a linha do pedido original. */
export function textoDoPedido(p: { quem: string | null; canal: string; protocolo: string | null }): string {
  const quem = p.quem ?? 'Alguém da equipe'
  const canal = ROTULO_DO_CANAL_DO_PEDIDO[p.canal] ?? p.canal.toLowerCase()
  return `${quem} enviou o pedido pelo ${canal}${p.protocolo ? ` · protocolo ${p.protocolo}` : ''}`
}
