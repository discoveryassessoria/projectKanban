// lib/operacional/precisa-de-voce-decisoes.ts
// ============================================================================
// PRECISA DE VOCÊ — AS DECISÕES DO DIA, COMO O PROTÓTIPO AS MOSTRA (Torre nova, frente B2, 01/10/2026).
//
// A leitura por TAREFA (`itensPrecisaDeVoce`, em `precisa-de-voce.ts`) continua sendo a base: o score, o Radar e a regra r1 leem
// ela. ESTE módulo é a camada de APRESENTAÇÃO DAS DECISÕES — funções PURAS (sem banco; `agora` e fuso injetáveis) que montam o
// que a Torre mostra nos 6 tipos do inventário §2.4:
//
//   Sem responsável  → UM item por PROCESSO ("Salvarani · 12 certidões sem responsável"), com a sugestão por aptidão comprovada;
//   Fase deixada     → UM item por PROCESSO ("Panza · Apostilamento sem próxima ação"), ação "Avançar fase" (porta canônica);
//   Escalada         → por tarefa ("<órgão> · <certidão>"), cobrança sem resposta ≥ limite do cadastro (`escalarApos`);
//   Divergência      → por tarefa, tarefa × passo × Central discordam;
//   Bloqueada        → por tarefa, bloqueada há 10+ dias;
//   Carga            → por pessoa ("<pessoa> · 91 executáveis (limite 80)").
//
// Cadastro (CAD-*/PAREDE_A_FRENTE) NÃO entra. Vocabulário oficial: "Sem responsável" (nunca "ninguém"/"Sem ninguém").
// ============================================================================
import { FUSO_OPERACIONAL, diaOperacional } from './tempo-operacional'
import { ROTULO_STATUS } from '@/src/lib/home/rotulo-status-tarefa'

/** Os 6 tipos do painel, na ORDEM dos cartões do protótipo. */
export const TIPOS_DO_PAINEL = ['SEM_DONO', 'FASE_DEIXADA', 'ESCALADA', 'DIVERGENCIA', 'BLOQUEADA', 'CARGA'] as const
export type TipoDoPainel = (typeof TIPOS_DO_PAINEL)[number]

/** O nome do tipo na tela — o selo, o cartão-filtro e o rodapé usam ESTE texto (vocabulário oficial: "Sem responsável"). */
export const ROTULO_DO_TIPO: Readonly<Record<TipoDoPainel, string>> = {
  SEM_DONO: 'Sem responsável', FASE_DEIXADA: 'Fase deixada', ESCALADA: 'Escalada',
  DIVERGENCIA: 'Divergência', BLOQUEADA: 'Bloqueada', CARGA: 'Carga',
}

/** O LIMITE do tipo Bloqueada: "esperando o cliente há 10+ dias" (inventário §1.2.1). */
export const DIAS_BLOQUEADA_PARA_DECIDIR = 10
/** Quantas cobranças sem resposta escalam, quando o cadastro não diz nada (default do próprio cadastro do passo). */
export const ESCALAR_APOS_PADRAO = 2

/** A regra escrita no cartão de cada tipo (inventário §1.2.1) — `escaladaApos` vem do cadastro do passo. */
export function regraDoTipo(tipo: TipoDoPainel, escaladaApos: number = ESCALAR_APOS_PADRAO): string {
  switch (tipo) {
    case 'SEM_DONO': return 'certidão ativa sem responsável'
    case 'FASE_DEIXADA': return 'fase sem próxima ação'
    case 'ESCALADA': return `cartório sem resposta após ${escaladaApos} ${escaladaApos === 1 ? 'cobrança' : 'cobranças'}`
    case 'DIVERGENCIA': return 'tarefa, passo e Central discordam'
    case 'BLOQUEADA': return `esperando o cliente há ${DIAS_BLOQUEADA_PARA_DECIDIR}+ dias`
    case 'CARGA': return 'pessoa acima do limite'
  }
}

// ─── FORMATAÇÃO ──────────────────────────────────────────────────────────────

export const certidoes = (n: number): string => `${n} ${n === 1 ? 'certidão' : 'certidões'}`
const dias = (n: number): string => `${n} ${n === 1 ? 'dia' : 'dias'}`
/** "2,0" — decimal com vírgula (PT-BR), uma casa. */
export const decimalPt = (n: number): string => n.toFixed(1).replace('.', ',')

const HORA = new Intl.DateTimeFormat('pt-BR', { timeZone: FUSO_OPERACIONAL, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
const DIA_MES = new Intl.DateTimeFormat('pt-BR', { timeZone: FUSO_OPERACIONAL, day: '2-digit', month: '2-digit' })

/** Dias de calendário (fuso operacional) entre duas datas — 0 = mesmo dia. */
export function diasDeCalendario(de: Date, ate: Date): number {
  const a = Date.parse(`${diaOperacional(de)}T00:00:00Z`)
  const b = Date.parse(`${diaOperacional(ate)}T00:00:00Z`)
  return Math.round((b - a) / 86_400_000)
}

/**
 * QUANDO O PROCESSO ENTROU NA FASE, como o protótipo escreve: "desde hoje 12:27" · "entrou ontem 14:15" · "entrou em 28/09 09:00".
 * Sem registro → "entrada na fase não registrada" (nunca um palpite).
 */
export function quandoEntrouNaFase(desde: Date | null, agora: Date): string {
  if (!desde) return 'entrada na fase não registrada'
  const hora = HORA.format(desde)
  const d = diasDeCalendario(desde, agora)
  if (d <= 0) return `desde hoje ${hora}`
  if (d === 1) return `entrou ontem ${hora}`
  return `entrou em ${DIA_MES.format(desde)} ${hora}`
}

const CANAL_POR_EXTENSO: Readonly<Record<string, string>> = {
  EMAIL: 'e-mail', TELEFONE: 'telefone', WHATSAPP: 'WhatsApp', OFICIO: 'ofício', PRESENCIAL: 'presencial',
}
/** "e-mail" · "e-mail e telefone" · "e-mail, telefone e ofício". */
export function canaisPorExtenso(canais: string[]): string {
  const nomes = [...new Set(canais)].map((c) => CANAL_POR_EXTENSO[c] ?? c.toLowerCase())
  if (nomes.length <= 1) return nomes[0] ?? ''
  return `${nomes.slice(0, -1).join(', ')} e ${nomes[nomes.length - 1]}`
}

const PASSO_POR_EXTENSO: Readonly<Record<string, string>> = {
  PENDENTE: 'pendente', DISPONIVEL: 'disponível', EM_ANDAMENTO: 'em andamento', AGUARDANDO: 'aguardando', BLOQUEADO: 'bloqueado',
  EXECUTADO: 'executado', AGUARDANDO_APROVACAO: 'aguardando aprovação', CONCLUIDO: 'concluído', FALHOU: 'falhou', CANCELADO: 'cancelado',
  DISPENSADO: 'dispensado', SUPERSEDIDO: 'substituído',
}
export const passoPorExtenso = (s: string | null | undefined): string => (s ? PASSO_POR_EXTENSO[s] ?? s.toLowerCase() : '—')
export const tarefaPorExtenso = (s: string | null | undefined): string => (s ? (ROTULO_STATUS[s] ?? s.toLowerCase()).toLowerCase() : '—')

/**
 * A CERTIDÃO + A PESSOA, em UM texto (regra: tarefa nunca só pelo número). O título da tarefa já traz a pessoa na maioria dos casos
 * ("Certidão de nascimento · Luigi Bellandi"); quando não traz (casamento, requerente…), acrescenta a pessoa da linha — sem inventar.
 */
export function identidadeDaCertidao(l: { titulo: string; pessoaNome: string | null; casalNomes?: string | null }): string {
  const titulo = l.titulo.trim()
  const quem = (l.casalNomes ?? l.pessoaNome ?? '').trim()
  if (!quem) return titulo
  const jaTem = titulo.toLowerCase().includes((l.pessoaNome ?? quem).trim().toLowerCase())
  return jaTem ? titulo : `${titulo} · ${quem}`
}

// ─── SEM RESPONSÁVEL (por processo) ─────────────────────────────────────────

export interface SugestaoParaTexto {
  usuarioId: number
  nome: string
  /** `true` = sem aptidão cadastrada: o nome é só o de menor carga — NÃO é aptidão comprovada, nunca vira "Atribuir a …". */
  fallback?: boolean
  /** Aptidão que justificou a escolha, por extenso ("apto em Itália", "apto a Certidões…") — só do cadastro. */
  aptidao?: string[]
  ativas?: number
  /** `true` = a pessoa está abaixo do limite de carga cadastrado ("fila livre"). */
  filaLivre?: boolean
}

export interface PlanoDoSemDono {
  /** Quem receberia cada grupo de tarefas (só aptos comprovados). */
  atribuicoes: Array<{ usuarioId: number; nome: string; tarefaIds: number[]; motivo: string }>
  /** Tarefas sem apto comprovado: ficam para a sua decisão. */
  semAptidao: number[]
}

/**
 * O PLANO de atribuição de um processo: agrupa as tarefas pela pessoa sugerida. A sugestão por tarefa é a de `escolherResponsavel`;
 * `fallback` (sem aptidão cadastrada) NÃO entra no plano — vai para `semAptidao`, que é decisão humana.
 */
export function planoDoSemDono(tarefas: Array<{ taskId: number; sugestao: SugestaoParaTexto | null }>): PlanoDoSemDono {
  const por = new Map<number, { nome: string; tarefaIds: number[]; motivo: string }>()
  const semAptidao: number[] = []
  for (const t of tarefas) {
    const s = t.sugestao
    if (!s || s.fallback) { semAptidao.push(t.taskId); continue }
    const atual = por.get(s.usuarioId) ?? { nome: s.nome, tarefaIds: [], motivo: '' }
    atual.tarefaIds.push(t.taskId)
    if (!atual.motivo) {
      const partes = [...(s.aptidao ?? [])]
      if (s.ativas != null) partes.push(certidoes(s.ativas))
      if (s.filaLivre) partes.push('fila livre')
      atual.motivo = partes.join(', ')
    }
    por.set(s.usuarioId, atual)
  }
  return {
    atribuicoes: [...por].map(([usuarioId, v]) => ({ usuarioId, ...v })).sort((a, b) => b.tarefaIds.length - a.tarefaIds.length || a.usuarioId - b.usuarioId),
    semAptidao,
  }
}

/** Título, sugestão e botões do item "Sem responsável" de um processo. */
export function textosDoSemDono(args: {
  familia: string; pais: string | null; faseLabel: string | null; entrouNaFase: Date | null; agora: Date
  total: number; plano: PlanoDoSemDono
}): { titulo: string; detalhe: string; sugestao: string; acao1: { rotulo: string; acao: string }; acao2: { rotulo: string; acao: string } } {
  const { plano } = args
  const titulo = `${args.familia} · ${certidoes(args.total)} sem responsável`
  const detalhe = [args.pais, args.faseLabel, quandoEntrouNaFase(args.entrouNaFase, args.agora)].filter((x): x is string => !!x).join(' · ')
  const [primeiro, ...resto] = plano.atribuicoes
  if (!primeiro) {
    return {
      titulo, detalhe,
      sugestao: 'Sem aptidão cadastrada para estas certidões — a decisão é sua',
      acao1: { rotulo: 'Escolher responsável', acao: 'ATRIBUIR_ESCOLHIDO' }, acao2: { rotulo: 'Ver equipe', acao: 'VER_EQUIPE' },
    }
  }
  const sobra = plano.semAptidao.length ? `; ${certidoes(plano.semAptidao.length)} sem aptidão cadastrada ${plano.semAptidao.length === 1 ? 'fica' : 'ficam'} para você` : ''
  if (resto.length === 0) {
    return {
      titulo, detalhe,
      sugestao: `Atribuir a ${primeiro.nome}${primeiro.motivo ? ` (${primeiro.motivo})` : ''}${sobra}`,
      acao1: { rotulo: `Atribuir a ${primeiro.nome}`, acao: 'ATRIBUIR_SUGERIDO' }, acao2: { rotulo: 'Escolher outro', acao: 'ATRIBUIR_ESCOLHIDO' },
    }
  }
  const quem = plano.atribuicoes.map((a) => `${a.nome} (${certidoes(a.tarefaIds.length)})`).join(', ')
  return {
    titulo, detalhe,
    sugestao: `Atribuir a ${quem}, cada uma a quem tem aptidão comprovada${sobra}`,
    acao1: { rotulo: 'Atribuir às sugeridas', acao: 'ATRIBUIR_SUGERIDO' }, acao2: { rotulo: 'Escolher outro', acao: 'ATRIBUIR_ESCOLHIDO' },
  }
}

// ─── FASE DEIXADA (por processo) ────────────────────────────────────────────

/**
 * O processo está numa fase SEM PRÓXIMA AÇÃO: nenhuma tarefa aberta na fase atual (nem do trabalho nem de espera) e a fase ainda
 * tem para onde ir. `ultimaConclusao` = a conclusão mais recente de tarefa DESTA fase; `entrouNaFase` = entrada de registro real.
 */
export function textosDaFaseDeixada(args: {
  familia: string; pais: string | null; faseLabel: string; proximaFaseLabel: string
  ultimaConclusao: Date | null; entrouNaFase: Date | null; agora: Date
}): { titulo: string; detalhe: string; sugestao: string } {
  const quando = args.ultimaConclusao
    ? `todas as tarefas da fase concluídas há ${dias(Math.max(0, diasDeCalendario(args.ultimaConclusao, args.agora)))}`
    : args.entrouNaFase
      ? `na fase há ${dias(Math.max(0, diasDeCalendario(args.entrouNaFase, args.agora)))} e sem nenhuma tarefa aberta`
      : 'sem nenhuma tarefa aberta na fase'
  return {
    titulo: `${args.familia} · ${args.faseLabel} sem próxima ação`,
    detalhe: [args.pais, quando, 'o próximo passo não foi marcado'].filter((x): x is string => !!x).join(' · '),
    sugestao: `Avançar para ${args.proximaFaseLabel} e abrir as tarefas dela`,
  }
}

// ─── ESCALADA ────────────────────────────────────────────────────────────────

export function textosDaEscalada(args: {
  orgao: string | null; certidao: string; familia: string | null; pais: string | null
  pedidoHaDias: number | null; cobrancas: number; canais: string[]
}): { titulo: string; detalhe: string; sugestao: string } {
  const pedido = args.pedidoHaDias != null ? `pedido há ${args.pedidoHaDias} d` : 'pedido não registrado'
  const porCanal = args.canais.length ? ` por ${canaisPorExtenso(args.canais)}` : ''
  const cobr = `${args.cobrancas} ${args.cobrancas === 1 ? 'cobrança' : 'cobranças'}${porCanal} sem resposta`
  const jaLigou = args.canais.includes('TELEFONE')
  return {
    titulo: `${args.orgao ?? 'Terceiro'} · ${args.certidao}`,
    detalhe: [args.pais, args.familia, pedido, cobr].filter((x): x is string => !!x).join(' · '),
    sugestao: jaLigou ? 'Registrar nova ligação ou trocar o canal da solicitação' : 'Trocar o canal para telefone e registrar a ligação',
  }
}

// ─── DIVERGÊNCIA ─────────────────────────────────────────────────────────────

export function textosDaDivergencia(args: {
  familia: string | null; certidao: string; pais: string | null
  statusTarefa: string; statusPasso: string; esperado: string | null
}): { titulo: string; detalhe: string; sugestao: string } {
  const esperado = args.esperado ? tarefaPorExtenso(args.esperado) : null
  return {
    titulo: `${args.familia ? `${args.familia} · ` : ''}${args.certidao}`,
    detalhe: [
      args.pais,
      `a tarefa diz "${tarefaPorExtenso(args.statusTarefa)}", o passo diz "${passoPorExtenso(args.statusPasso)}"${esperado ? `, a Central espera "${esperado}"` : ''}`,
    ].filter((x): x is string => !!x).join(' · '),
    sugestao: esperado ? `Reconciliar pela Central: a tarefa passa a espelhar o passo ("${esperado}")` : 'Reconciliar pela Central: a tarefa passa a espelhar o passo',
  }
}

// ─── BLOQUEADA ───────────────────────────────────────────────────────────────

export function textosDaBloqueada(args: {
  familia: string | null; certidao: string; pais: string | null; faseLabel: string | null
  bloqueadaHaDias: number | null; cobrancasAoCliente: number; motivo: string | null
}): { titulo: string; detalhe: string; sugestao: string } {
  const quando = args.bloqueadaHaDias != null ? `bloqueada há ${args.bloqueadaHaDias} d` : 'bloqueio sem data registrada'
  const cobr = `${args.cobrancasAoCliente} ${args.cobrancasAoCliente === 1 ? 'cobrança' : 'cobranças'} ao cliente`
  return {
    titulo: `${args.familia ? `${args.familia} · ` : ''}${args.certidao}`,
    detalhe: [args.pais, args.faseLabel, quando, cobr, args.motivo ? `motivo: ${args.motivo}` : null].filter((x): x is string => !!x).join(' · '),
    sugestao: 'Cobrar o cliente de novo pelo chat do processo; sem resposta, pausar o processo',
  }
}

/** A tarefa bloqueada entra no painel? Bloqueada há 10+ dias, ou sem data registrada (nunca se prova que é recente). */
export const bloqueioPedeDecisao = (haDias: number | null): boolean => haDias == null || haDias >= DIAS_BLOQUEADA_PARA_DECIDIR

// ─── CARGA ───────────────────────────────────────────────────────────────────

/** Quantas certidões mover para a pessoa sair do limite: o suficiente para ficar UMA abaixo, limitado ao que ainda não foi iniciado. */
export function quantoMoverDaCarga(args: { executaveis: number; limite: number; aIniciar: number }): number {
  return Math.max(0, Math.min(args.aIniciar, args.executaveis - args.limite + 1))
}

export function textosDaCarga(args: {
  nome: string; executaveis: number; limite: number; vencidas: number; filaEmSemanas: number | null
  mover: number; paisDasMovidas: string | null; destinos: string[]
}): { titulo: string; detalhe: string; sugestao: string; rotuloAcao1: string } {
  const fila = args.filaEmSemanas != null ? `fila de ${decimalPt(args.filaEmSemanas)} ${args.filaEmSemanas === 1 ? 'semana' : 'semanas'}` : 'fila não calculável (sem conclusões recentes)'
  let sugestao: string
  if (args.mover <= 0) sugestao = 'Nenhuma certidão ainda não iniciada para mover — decida na Equipe'
  else if (args.destinos.length === 0) sugestao = `Mover ${certidoes(args.mover)}: sem pessoa apta com fila livre — decida na Equipe`
  else sugestao = `Mover ${certidoes(args.mover)}${args.paisDasMovidas ? ` de ${args.paisDasMovidas}` : ''} para ${args.destinos.join(' e ')} (fila livre)`
  return {
    titulo: `${args.nome} · ${args.executaveis} executáveis (limite ${args.limite})`,
    detalhe: `${args.vencidas} ${args.vencidas === 1 ? 'vencida' : 'vencidas'} · ${fila}`,
    sugestao,
    rotuloAcao1: args.mover > 0 ? `Redistribuir ${args.mover}` : 'Redistribuir',
  }
}

// ─── BRIEFING (texto do dia, dos números reais) ─────────────────────────────

/** Contagem por tipo — a MESMA que os cartões-filtro mostram. */
export function contagemPorTipo(itens: Array<{ tipo: string }>): Record<TipoDoPainel, number> {
  const c = Object.fromEntries(TIPOS_DO_PAINEL.map((t) => [t, 0])) as Record<TipoDoPainel, number>
  for (const i of itens) if ((TIPOS_DO_PAINEL as readonly string[]).includes(i.tipo)) c[i.tipo as TipoDoPainel] += 1
  return c
}

// ─── BRIEFING DO DIA — TEXTO PURO ───────────────────────────────────────────
// Mora AQUI (módulo puro, importável pela tela) para que o Briefing seja montado no CLIENTE com os MESMOS conjuntos que os cartões
// mostram (país escolhido, "no ritmo" = a classe do funil). Antes ele vinha pronto do servidor, global e com "no ritmo" por outra
// régua: com país escolhido o botão dizia 0 decisões e o texto 2.

/** O mínimo que o texto lê de cada decisão (qualquer ItemPrecisaDeVoceTorre cabe). */
export interface ItemParaBriefing { tipo: string; familiaNome: string | null; contexto: Record<string, unknown> }


/** A saudação pelo relógio de SÃO PAULO, nunca o do servidor (achado real,
 * 30/09/2026: em UTC "23h40 de terça" virava "Bom dia" — o servidor não
 * mora no fuso da operação). Bom dia 5h–12h, boa tarde 12h–18h, boa noite depois. */
function saudacao(agora: Date): string {
  const hora = Number(agora.toLocaleString('en-US', { timeZone: FUSO_OPERACIONAL, hour: 'numeric', hourCycle: 'h23' }))
  if (hora >= 5 && hora < 12) return 'Bom dia'
  if (hora >= 12 && hora < 18) return 'Boa tarde'
  return 'Boa noite'
}

/** Os números do dia que o texto do Briefing cita ALÉM das decisões — todos de leitura real; ausente = a frase correspondente não aparece. */
export interface ExtrasDoBriefing {
  nome?: string | null
  ativos?: number
  noRitmo?: number
  fechadasOntem?: number
  protocoladosOntem?: number
  vencemHoje?: number
}

const juntar = (partes: string[]): string => (partes.length <= 1 ? partes[0] ?? '' : `${partes.slice(0, -1).join(', ')} e ${partes[partes.length - 1]}`)
const pl = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`

/**
 * O TEXTO DO BRIEFING — a estrutura do protótipo ("Bom dia, <nome>. N processos ativos, M no ritmo. Ontem… Hoje vencem… N decisões
 * esperam você: …"), com os números REAIS. O que o sistema não mede (gargalo da semana, cobranças a fazer) não é escrito.
 */
export function briefingDoDia(itens: ItemParaBriefing[], agora = new Date(), extras: ExtrasDoBriefing = {}): string {
  const dataFmt = agora.toLocaleDateString('pt-BR', { timeZone: FUSO_OPERACIONAL, weekday: 'long', day: '2-digit', month: 'long' })
  const primeiroNome = extras.nome?.trim().split(/\s+/)[0]
  const abertura = `${saudacao(agora)}${primeiroNome ? `, ${primeiroNome}` : ''}.`
  if (itens.length === 0) return `${abertura} Hoje, ${dataFmt}: nada precisa de você agora.`

  const frases: string[] = [abertura]
  if (extras.ativos != null) frases.push(`${pl(extras.ativos, 'processo ativo', 'processos ativos')}${extras.noRitmo != null ? `, ${extras.noRitmo} no ritmo` : ''}.`)
  if (extras.fechadasOntem != null || extras.protocoladosOntem != null) {
    const partes: string[] = []
    if (extras.fechadasOntem != null) partes.push(`a equipe fechou ${certidoes(extras.fechadasOntem)}`)
    if (extras.protocoladosOntem != null) partes.push(`${pl(extras.protocoladosOntem, 'processo foi protocolado', 'processos foram protocolados')}`)
    frases.push(`Ontem ${partes.join(' e ')}.`)
  }
  if (extras.vencemHoje != null) frases.push(extras.vencemHoje === 1 ? 'Hoje vence 1 prazo.' : `Hoje vencem ${extras.vencemHoje} prazos.`)

  const c = contagemPorTipo(itens)
  const semDono = itens.filter((i) => i.tipo === 'SEM_DONO')
  const detalhes: string[] = []
  if (c.SEM_DONO > 0) {
    const grandes = semDono
      .filter((i) => i.familiaNome)
      .map((i) => ({ familia: i.familiaNome as string, n: Array.isArray(i.contexto.tarefaIds) ? (i.contexto.tarefaIds as number[]).length : 1 }))
      .sort((a, b) => b.n - a.n).slice(0, 2)
    const concentram = grandes.length >= 2
      ? ` (${grandes[0].familia} e ${grandes[1].familia} concentram ${grandes[0].n + grandes[1].n})`
      : grandes.length === 1 ? ` (${grandes[0].familia} concentra ${grandes[0].n})` : ''
    detalhes.push(`${pl(c.SEM_DONO, 'processo com certidões sem responsável', 'processos com certidões sem responsável')}${concentram}`)
  }
  if (c.FASE_DEIXADA > 0) detalhes.push(pl(c.FASE_DEIXADA, 'fase deixada sem próxima ação', 'fases deixadas sem próxima ação'))
  if (c.ESCALADA > 0) detalhes.push(pl(c.ESCALADA, 'cobrança escalada sem resposta', 'cobranças escaladas sem resposta'))
  if (c.DIVERGENCIA > 0) detalhes.push(pl(c.DIVERGENCIA, 'divergência para reconciliar', 'divergências para reconciliar'))
  if (c.BLOQUEADA > 0) detalhes.push(pl(c.BLOQUEADA, 'tarefa bloqueada há 10+ dias', 'tarefas bloqueadas há 10+ dias'))
  if (c.CARGA > 0) {
    const cargas = itens.filter((i) => i.tipo === 'CARGA')
    const maior = cargas.map((i) => ({ nome: i.familiaNome ?? '', ...(i.contexto as { executaveis?: number; limite?: number }) }))
      .filter((x) => x.executaveis != null && x.limite)
      .sort((a, b) => (b.executaveis! / b.limite!) - (a.executaveis! / a.limite!))[0]
    const acima = maior ? ` (${maior.nome} está com ${maior.executaveis} executáveis, ${Math.round((maior.executaveis! / maior.limite! - 1) * 100)}% ${maior.executaveis! >= maior.limite! ? 'acima do' : 'abaixo do'} limite de ${maior.limite})` : ''
    detalhes.push(`${pl(c.CARGA, 'aviso de carga', 'avisos de carga')}${acima}`)
  }
  frases.push(`${itens.length === 1 ? '1 decisão espera' : `${itens.length} decisões esperam`} você: ${juntar(detalhes)}.`)
  return frases.join(' ')
}

