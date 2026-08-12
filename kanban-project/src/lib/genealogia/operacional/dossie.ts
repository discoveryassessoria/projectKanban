// src/lib/genealogia/operacional/dossie.ts
//
// DOSSIÊ OPERACIONAL DA PESSOA — projeção, nunca fonte.
//
// A árvore passa a responder, por pessoa: o que se exige dela, o que já veio, o
// que falta, o que diverge, que tarefa está aberta, quanto custa, quanto rende e
// qual é a próxima ação. Nada disso nasce aqui.
//
// FONTE DE CADA NÚMERO (e é assim que fica):
//   • documentos exigidos/recebidos/pendentes → NecessidadeDocumental, via
//     `documental/indicadores.ts`. O Sistema Documental é o dono da regra; a
//     árvore só agrupa o que ele já decidiu.
//   • divergências → insights do motor genealógico (conflito, duplicidade,
//     sobrenome). Não são "erros de documento": são contradições de DADO, que é
//     o que a árvore sabe apurar.
//   • tarefas → Tarefa do processo, ligada à pessoa pela necessidade que a
//     originou. A árvore não cria nem conclui tarefa.
//   • custos e receitas → ObrigacaoEconomica com `personId`, e recebido pelo
//     Ledger. A árvore não soma valor por conta própria e não conhece regra de
//     preço.
//
// O que este módulo ACRESCENTA e que não existe em lugar nenhum: a junção. Hoje
// o operador precisa de quatro telas para montar mentalmente o que segue abaixo.
//
// PURO: sem prisma, sem rede, sem relógio. Recebe os fatos já lidos e projeta.

import type { GrafoGenealogico } from "../motor/grafo"
import type { AnaliseArvore, Insight, Severidade } from "../motor/tipos"
import { ORDEM_SEVERIDADE, piorSeveridade } from "../motor/tipos"
import type { Linhagem, MapaLinhagens } from "../motor/linhagens"
import { requerentesQueDependemDe } from "../motor/linhagens"
import {
  indicadorDaPessoa,
  indicadorVazio,
  projetarIndicadores,
  ROTULO_SITUACAO,
  type IndicadorDocumental,
  type NecessidadeOficial,
  type ProjecaoDocumental,
  type SituacaoDocumental,
} from "../documental/indicadores"
import { nomeCompleto } from "../motor/texto"

// ── FATOS: o contrato do que a leitura entrega ──────────────────────────────
// Espelho fiel do endpoint. Campos extras são ignorados de propósito: quando o
// domínio ganhar coluna, esta camada não precisa mudar para continuar correta.

export interface TarefaDaPessoa {
  id: number
  titulo: string
  /** true quando já concluída — entra no total, sai das abertas. */
  concluida: boolean
  statusTarefa?: string | null
  prioridade?: string | null
  /** ISO. */
  dataPrazo?: string | null
  responsavel?: string | null
  /** Necessidade que originou a tarefa — é por ela que a tarefa pertence a alguém. */
  necessidadeId?: number | null
}

export interface LancamentoDaPessoa {
  id: number
  /** RECEITA | CUSTO — como a ObrigacaoEconomica classifica. */
  natureza: string
  descricao: string
  moeda: string
  /** Valor contratado, na moeda da obrigação. */
  valor: number
  /** Recebido/pago segundo o Ledger. Ausente quando o Ledger não projetou. */
  recebido?: number | null
  saldo?: number | null
  status?: string | null
}

/**
 * Fatos operacionais do processo, por sujeito. É o que o endpoint devolve.
 * `financeiroVisivel = false` significa que o usuário não tem `financeiro.ver`:
 * a lista vem vazia porque foi OMITIDA, não porque não existe — e o painel diz
 * isso, em vez de mostrar "R$ 0,00" e mentir.
 */
export interface FatosOperacionais {
  necessidades: NecessidadeOficial[]
  tarefas: Array<TarefaDaPessoa & { pessoaId: number | null }>
  lancamentos: Array<LancamentoDaPessoa & { pessoaId: number | null }>
  financeiroVisivel: boolean
}

export function fatosVazios(): FatosOperacionais {
  return { necessidades: [], tarefas: [], lancamentos: [], financeiroVisivel: false }
}

// ── DOSSIÊ ──────────────────────────────────────────────────────────────────

export interface TotalPorMoeda {
  moeda: string
  valor: number
  recebido: number
}

export interface DossiePessoa {
  pessoaId: number
  nome: string
  /** Indicador documental oficial, já somando as uniões da pessoa. */
  documental: IndicadorDocumental
  situacao: SituacaoDocumental
  rotuloSituacao: string
  /** Contradições de dado apuradas pelo motor. Não são pendência documental. */
  divergencias: Insight[]
  severidadeMax: Severidade | null
  tarefasAbertas: TarefaDaPessoa[]
  tarefasConcluidas: number
  custos: TotalPorMoeda[]
  receitas: TotalPorMoeda[]
  /** Requerentes cuja cidadania depende desta pessoa. */
  requerentesDependentes: number[]
  /** Frase única e acionável. Nunca inventada: sai de um fato acima. */
  proximaAcao: string | null
  /** Peso para ordenar pessoas por urgência. Determinístico. */
  urgencia: number
}

export interface ContextoDossie {
  grafo: GrafoGenealogico
  analise: AnaliseArvore | null
  mapa: MapaLinhagens
  fatos: FatosOperacionais
}

const CATEGORIAS_DIVERGENCIA = new Set(["conflito", "duplicidade", "sobrenome"])

/** Uniões de uma pessoa — a certidão de casamento é exigida da união. */
function uniaoIdsDe(g: GrafoGenealogico, pessoaId: number): number[] {
  return g
    .unioesDe(pessoaId)
    .map((u) => u.id)
    .filter((id): id is number => typeof id === "number")
}

export function projetarDossies(ctx: ContextoDossie): Map<number, DossiePessoa> {
  const { grafo, analise, mapa, fatos } = ctx
  const projecao = projetarIndicadores(fatos.necessidades)

  // Necessidade → pessoa. É este mapa que dá dono à tarefa: a Tarefa aponta para
  // a necessidade, e a necessidade para a pessoa. Sem ele a tarefa é do processo
  // inteiro e o painel da pessoa mostraria tarefa alheia.
  const pessoaDaNecessidade = new Map<number, number>()
  for (const n of fatos.necessidades) {
    if (n?.pessoaId != null) pessoaDaNecessidade.set(n.id, n.pessoaId)
  }

  const tarefasPorPessoa = new Map<number, TarefaDaPessoa[]>()
  for (const t of fatos.tarefas) {
    const dono =
      t.pessoaId ?? (t.necessidadeId != null ? pessoaDaNecessidade.get(t.necessidadeId) : undefined)
    if (dono == null) continue
    const lista = tarefasPorPessoa.get(dono)
    if (lista) lista.push(t)
    else tarefasPorPessoa.set(dono, [t])
  }

  const lancamentosPorPessoa = new Map<number, LancamentoDaPessoa[]>()
  for (const l of fatos.lancamentos) {
    if (l.pessoaId == null) continue
    const lista = lancamentosPorPessoa.get(l.pessoaId)
    if (lista) lista.push(l)
    else lancamentosPorPessoa.set(l.pessoaId, [l])
  }

  const divergenciasPorPessoa = new Map<number, Insight[]>()
  for (const i of analise?.insights ?? []) {
    if (!CATEGORIAS_DIVERGENCIA.has(i.categoria)) continue
    for (const id of i.pessoaIds) {
      const lista = divergenciasPorPessoa.get(id)
      if (lista) lista.push(i)
      else divergenciasPorPessoa.set(id, [i])
    }
  }

  const dossies = new Map<number, DossiePessoa>()

  for (const p of grafo.pessoas) {
    const documental = indicadorDaPessoa(projecao, p.id, uniaoIdsDe(grafo, p.id))
    const divergencias = (divergenciasPorPessoa.get(p.id) ?? []).sort(
      (a, b) => b.peso - a.peso || a.id.localeCompare(b.id),
    )
    const todasTarefas = tarefasPorPessoa.get(p.id) ?? []
    const tarefasAbertas = todasTarefas
      .filter((t) => !t.concluida)
      .sort(ordenarTarefas)
    const lancamentos = lancamentosPorPessoa.get(p.id) ?? []

    let severidadeMax: Severidade | null = null
    for (const d of divergencias) severidadeMax = piorSeveridade(severidadeMax, d.severidade)

    const dependentes = requerentesQueDependemDe(mapa, p.id)

    const dossie: DossiePessoa = {
      pessoaId: p.id,
      nome: nomeCompleto(p),
      documental,
      situacao: documental.situacao,
      rotuloSituacao: ROTULO_SITUACAO[documental.situacao],
      divergencias,
      severidadeMax,
      tarefasAbertas,
      tarefasConcluidas: todasTarefas.length - tarefasAbertas.length,
      custos: somarPorMoeda(lancamentos.filter((l) => ehCusto(l.natureza))),
      receitas: somarPorMoeda(lancamentos.filter((l) => ehReceita(l.natureza))),
      requerentesDependentes: dependentes,
      proximaAcao: null,
      urgencia: 0,
    }
    dossie.proximaAcao = decidirProximaAcao(dossie)
    dossie.urgencia = calcularUrgencia(dossie)
    dossies.set(p.id, dossie)
  }

  return dossies
}

/**
 * PRÓXIMA AÇÃO — uma frase, derivada de um fato, nunca de um palpite.
 *
 * A ordem abaixo é a ordem em que o trabalho realmente trava: um documento não
 * localizado bloqueia; uma contradição de dado invalida o documento que vier;
 * uma exigência não iniciada é trabalho parado; uma tarefa aberta já tem dono.
 * Quando nada disso existe, a resposta honesta é "nada pendente" — devolver
 * null, e não uma sugestão inventada para preencher a linha.
 */
export function decidirProximaAcao(d: DossiePessoa): string | null {
  if (d.documental.naoLocalizadas > 0) {
    return `Resolver ${contar(d.documental.naoLocalizadas, "documento não localizado", "documentos não localizados")} — é o que trava o dossiê.`
  }
  const critica = d.divergencias.find((i) => i.severidade === "critico" || i.severidade === "alto")
  if (critica) return critica.acao ?? critica.titulo
  if (d.documental.pendentes > 0) {
    return `Iniciar ${contar(d.documental.pendentes, "exigência documental pendente", "exigências documentais pendentes")}.`
  }
  if (d.tarefasAbertas.length > 0) {
    return `Concluir a tarefa “${d.tarefasAbertas[0].titulo}”.`
  }
  if (d.documental.emAtendimento > 0) {
    return `Acompanhar ${contar(d.documental.emAtendimento, "documento em atendimento", "documentos em atendimento")}.`
  }
  const menor = d.divergencias[0]
  if (menor) return menor.acao ?? menor.titulo
  return null
}

/**
 * Urgência: quanto esta pessoa deve ser olhada antes das outras.
 *
 * O multiplicador por requerentes dependentes é o ponto que diferencia esta
 * árvore de uma lista de pendências: a mesma pendência num bisavô de cinco
 * requerentes vale cinco vezes mais que num sogro de nenhum.
 */
export function calcularUrgencia(d: DossiePessoa): number {
  let base = 0
  base += d.documental.naoLocalizadas * 40
  base += d.documental.pendentes * 12
  base += d.documental.emAtendimento * 4
  for (const i of d.divergencias) base += ORDEM_SEVERIDADE[i.severidade] * 6
  base += d.tarefasAbertas.length * 5
  const dependentes = Math.max(1, d.requerentesDependentes.length)
  return Math.round(base * dependentes)
}

// ── RESUMO DA LINHAGEM ──────────────────────────────────────────────────────

export interface PrazoDoProcesso {
  /** Vem da engine ÚNICA de SLA. A árvore não estima prazo por conta própria. */
  rotuloDias: string
  rotuloStatus: string
  status: string
  diasParaVencimento: number | null
  prazoPrevisto: string | null
  configurado: boolean
}

export interface ResumoLinhagem {
  requerenteId: number
  nome: string
  pessoas: number
  geracoes: number
  danteCausaId: number | null
  /** Nome do ascendente transmissor, pronto para a tela. */
  danteCausaNome: string | null
  /** Exigências marcadas como NÃO LOCALIZADA — o que de fato trava. */
  bloqueios: number
  tarefasVencidas: number
  /** Consolidado documental de TODA a linha (pessoas + cônjuges delas). */
  documental: IndicadorDocumental
  divergencias: number
  tarefasAbertas: number
  /** Pessoa mais urgente da linha — para onde o operador deve olhar primeiro. */
  focoId: number | null
  proximaAcao: string | null
  /**
   * Prazo do PROCESSO segundo o SLA oficial. `null` quando não há projeção —
   * a árvore diz "sem prazo configurado" em vez de inventar uma estimativa por
   * contagem de documento, que seria uma segunda engine de prazo.
   */
  prazo: PrazoDoProcesso | null
}

export function resumirLinhagem(
  linhagem: Linhagem,
  dossies: Map<number, DossiePessoa>,
  prazo: PrazoDoProcesso | null = null,
  /** Data de referência para "tarefa vencida". Injetada — nada lê o relógio. */
  agora: Date = new Date(0),
): ResumoLinhagem {
  const ids = [...linhagem.visivel]
  const documental = indicadorVazio()
  let divergencias = 0
  let tarefasAbertas = 0
  let tarefasVencidas = 0
  let focoId: number | null = null
  let maiorUrgencia = -1

  for (const id of ids) {
    const d = dossies.get(id)
    if (!d) continue
    documental.necessarias += d.documental.necessarias
    documental.atendidas += d.documental.atendidas
    documental.emAtendimento += d.documental.emAtendimento
    documental.pendentes += d.documental.pendentes
    documental.naoLocalizadas += d.documental.naoLocalizadas
    documental.dispensadas += d.documental.dispensadas
    documental.opcionais += d.documental.opcionais
    divergencias += d.divergencias.length
    tarefasAbertas += d.tarefasAbertas.length
    for (const t of d.tarefasAbertas) {
      if (!t.dataPrazo) continue
      const prazoMs = Date.parse(t.dataPrazo)
      if (Number.isFinite(prazoMs) && prazoMs < agora.getTime()) tarefasVencidas++
    }
    // Só entra quem tem alguma urgência real; desempate por id, para que a mesma
    // linha aponte sempre para a mesma pessoa entre dois carregamentos.
    if (d.urgencia > 0) {
      const vence =
        d.urgencia > maiorUrgencia || (d.urgencia === maiorUrgencia && focoId != null && id < focoId)
      if (vence) {
        maiorUrgencia = d.urgencia
        focoId = id
      }
    }
  }

  const resolvidas = documental.atendidas + documental.dispensadas
  documental.progresso =
    documental.necessarias > 0 ? Math.round((resolvidas / documental.necessarias) * 100) : null
  documental.situacao =
    documental.necessarias === 0
      ? "sem_exigencia"
      : documental.naoLocalizadas > 0
        ? "bloqueado"
        : documental.pendentes > 0
          ? "pendente"
          : documental.emAtendimento > 0
            ? "em_andamento"
            : "completo"

  const foco = focoId != null ? dossies.get(focoId) : null

  return {
    requerenteId: linhagem.requerenteId,
    nome: linhagem.nome,
    pessoas: ids.length,
    geracoes: linhagem.geracoes,
    danteCausaId: linhagem.danteCausaId,
    danteCausaNome:
      linhagem.danteCausaId != null
        ? (dossies.get(linhagem.danteCausaId)?.nome ?? null)
        : null,
    bloqueios: documental.naoLocalizadas,
    tarefasVencidas,
    documental,
    divergencias,
    tarefasAbertas,
    focoId,
    proximaAcao: foco ? (foco.proximaAcao ? `${foco.nome}: ${foco.proximaAcao}` : null) : null,
    prazo,
  }
}

// ── auxiliares ──────────────────────────────────────────────────────────────

function ehCusto(natureza: string): boolean {
  const n = (natureza || "").toUpperCase()
  return n === "CUSTO" || n === "REEMBOLSO"
}

function ehReceita(natureza: string): boolean {
  const n = (natureza || "").toUpperCase()
  return n === "RECEITA" || n === "RECEITA_EXTRA"
}

/**
 * Soma por MOEDA, nunca convertendo. Converter aqui exigiria uma taxa, e taxa é
 * do motor de câmbio — somar EUR com BRL num número só seria inventar valor.
 */
function somarPorMoeda(lancamentos: LancamentoDaPessoa[]): TotalPorMoeda[] {
  const por = new Map<string, TotalPorMoeda>()
  for (const l of lancamentos) {
    const moeda = l.moeda || "BRL"
    const atual = por.get(moeda) ?? { moeda, valor: 0, recebido: 0 }
    atual.valor += Number(l.valor) || 0
    atual.recebido += Number(l.recebido ?? 0) || 0
    por.set(moeda, atual)
  }
  return [...por.values()].sort((a, b) => a.moeda.localeCompare(b.moeda))
}

const PESO_STATUS_TAREFA: Record<string, number> = {
  BLOQUEADA: 0,
  EM_ANDAMENTO: 1,
  NAO_INICIADA: 2,
}

function ordenarTarefas(a: TarefaDaPessoa, b: TarefaDaPessoa): number {
  const pa = PESO_STATUS_TAREFA[(a.statusTarefa || "").toUpperCase()] ?? 3
  const pb = PESO_STATUS_TAREFA[(b.statusTarefa || "").toUpperCase()] ?? 3
  if (pa !== pb) return pa - pb
  // Sem prazo vai para o fim: uma tarefa sem data não compete com uma que vence.
  const da = a.dataPrazo ? Date.parse(a.dataPrazo) : Number.POSITIVE_INFINITY
  const db = b.dataPrazo ? Date.parse(b.dataPrazo) : Number.POSITIVE_INFINITY
  if (da !== db) return da - db
  return a.id - b.id
}

function contar(n: number, singular: string, plural: string): string {
  return `${n} ${n === 1 ? singular : plural}`
}

export type { ProjecaoDocumental }
