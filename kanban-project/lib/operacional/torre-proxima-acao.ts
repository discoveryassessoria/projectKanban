// lib/operacional/torre-proxima-acao.ts
// ============================================================================
// A PRÓXIMA AÇÃO DO PROCESSO (aba Processos) — DERIVADA das tarefas abertas, nunca digitada (PROGRESSO.md, decisão 3).
//
// PURO: sem Prisma, sem relógio. A obrigação "Atribuir tarefas" foi descontinuada e NÃO é recriada: não há segunda representação —
// a próxima ação é uma LEITURA das tarefas abertas da FASE ATUAL do processo. Dono e prazo vêm da própria tarefa escolhida.
//
// QUAL TAREFA MANDA (a mais urgente; empate → prazo mais próximo, depois a de menor id):
//   0  atrasada                                  (prazo vencido — qualquer estado; o texto segue o que fazer com ela)
//   1  cobrança a fazer                          (esperando terceiro com o acompanhamento vencido)
//   2  sem responsável                           ("distribuir")
//   3  bloqueada                                 ("resolver o bloqueio")
//   4  prazo hoje ou amanhã
//   5  a iniciar                                 (ponto de entrada ainda não tocado)
//   6  em andamento / executável
//   7  aguardando (terceiro ou cliente)          ("aguardar retorno")
// O TEXTO nasce do estado da tarefa escolhida + QUANTAS tarefas da fase têm o mesmo motivo ("Distribuir as 12 certidões",
// "Cobrar Cartório de Caxias do Sul (3 certidões)", "Aguardar retorno de 1º Ofício de Santos: Certidão de nascimento · Maria").
// Sem tarefa aberta na fase atual → `null` (a tela mostra "—"). Nunca um texto de exemplo.
// ============================================================================
import { diaMesDoPrazo } from '@/src/lib/tarefa/texto-prazo'
import { diasEntreDiasOperacionais } from './tempo-operacional'

/** O que da LINHA de tarefa decide a próxima ação (subconjunto de `LinhaDaTorre`). */
export interface LinhaParaProximaAcao {
  taskId: number
  titulo: string
  statusTarefa: string
  faseMacroKey: string | null
  responsavelId: number | null
  responsavelNome: string | null
  dataPrazo: string | null
  atrasada: boolean
  diasParaPrazo: number | null
  estadoOperacao: 'FILA' | 'AGUARDANDO' | 'CONCLUIDA'
  esperandoDe: 'terceiro' | 'cliente' | null
  acompanhamentoVencido: boolean
  cobravelVencida?: boolean
  totalCobrancas?: number
  terceiroNome: string | null
  documentoId: number | null
  aIniciar?: boolean
}

export type TipoDaProximaAcao = 'cobrar' | 'distribuir' | 'desbloquear' | 'iniciar' | 'executar' | 'aguardar'

export interface ProximaAcao {
  /** O que fazer (decide o texto). */
  tipo: TipoDaProximaAcao
  /** Por que é urgente, quando é: prazo vencido ou prazo hoje/amanhã. */
  urgencia: 'atrasada' | 'vence_em_breve' | null
  texto: string
  /** A tarefa que manda (responsável e prazo da linha vêm DELA). */
  tarefaId: number
  responsavelId: number | null
  responsavelNome: string | null
  dataPrazo: string | null
  /** Quantas tarefas abertas da fase pedem o mesmo (inclui a escolhida). */
  quantas: number
}

const RANK_DO_TIPO: Record<TipoDaProximaAcao, number> = { cobrar: 1, distribuir: 2, desbloquear: 3, iniciar: 5, executar: 6, aguardar: 7 }
const RANK_URGENTE = { atrasada: 0, vence_em_breve: 4 } as const

/** O que fazer com a tarefa. Total e determinística. */
export function tipoDaTarefa(l: LinhaParaProximaAcao): TipoDaProximaAcao {
  const esperando = l.estadoOperacao === 'AGUARDANDO' || l.esperandoDe != null
  // Sem responsável, o primeiro passo é ATRIBUIR (ninguém cobra, aguarda ou executa o que não tem dono) — mesmo se a tarefa já espera um terceiro.
  if (l.responsavelId == null) return 'distribuir'
  if (esperando && (l.acompanhamentoVencido || l.cobravelVencida)) return 'cobrar'
  if (l.statusTarefa === 'BLOQUEADA') return 'desbloquear'
  if (esperando) return 'aguardar'
  if (l.aIniciar && l.statusTarefa === 'NAO_INICIADA') return 'iniciar'
  return 'executar'
}
export function urgenciaDaTarefa(l: LinhaParaProximaAcao): 'atrasada' | 'vence_em_breve' | null {
  if (l.atrasada) return 'atrasada'
  return l.diasParaPrazo != null && l.diasParaPrazo >= 0 && l.diasParaPrazo <= 1 ? 'vence_em_breve' : null
}
/** Menor = mais urgente: atrasada (0) · cobrança (1) · sem responsável (2) · bloqueada (3) · prazo hoje/amanhã (4) · a iniciar (5) · executar (6) · aguardar (7). */
const rankDaTarefa = (l: LinhaParaProximaAcao): number => {
  const u = urgenciaDaTarefa(l)
  const t = RANK_DO_TIPO[tipoDaTarefa(l)]
  return u === 'atrasada' ? RANK_URGENTE.atrasada : u === 'vence_em_breve' ? Math.min(t, RANK_URGENTE.vence_em_breve) : t
}

const substantivo = (ls: LinhaParaProximaAcao[], n: number) => (ls.every((l) => l.documentoId != null) ? (n === 1 ? 'certidão' : 'certidões') : n === 1 ? 'tarefa' : 'tarefas')
const dataPrazoMs = (l: LinhaParaProximaAcao) => (l.dataPrazo ? new Date(l.dataPrazo).getTime() : Number.POSITIVE_INFINITY)

/**
 * A PRÓXIMA AÇÃO do processo a partir das linhas de tarefa ABERTAS. Só entram as da fase `faseAtualKey` (leitura escopada por
 * ciclo: tarefa de outra fase nunca vaza para a fase consultada). `null` = nenhuma tarefa elegível.
 */
export function proximaAcaoDoProcesso(linhas: LinhaParaProximaAcao[], faseAtualKey: string | null, ordemDaFase?: ReadonlyMap<string, number>): ProximaAcao | null {
  const abertas = linhas.filter((l) => l.estadoOperacao !== 'CONCLUIDA' && (faseAtualKey == null || l.faseMacroKey === faseAtualKey))
  if (abertas.length === 0) return null
  // Com `ordemDaFase` a escolha começa pela fase MAIS ANTIGA (é ela que trava as seguintes) e a contagem é a de todas as fases abertas.
  const faseOrd = (l: LinhaParaProximaAcao) => (ordemDaFase && l.faseMacroKey ? ordemDaFase.get(l.faseMacroKey) ?? 9000 : 0)
  const ordenadas = [...abertas].sort((a, b) => faseOrd(a) - faseOrd(b) || rankDaTarefa(a) - rankDaTarefa(b) || dataPrazoMs(a) - dataPrazoMs(b) || a.taskId - b.taskId)
  const l = ordenadas[0]
  const tipo = tipoDaTarefa(l)
  const mesmas = abertas.filter((m) => tipoDaTarefa(m) === tipo)
  const n = mesmas.length

  let texto: string
  switch (tipo) {
    case 'cobrar': {
      const quem = l.terceiroNome ?? 'o terceiro'
      const doMesmo = mesmas.filter((m) => m.terceiroNome === l.terceiroNome)
      texto = doMesmo.length > 1
        ? `Cobrar ${quem} (${doMesmo.length} ${substantivo(doMesmo, doMesmo.length)})`
        : `Cobrar ${quem} (${(l.totalCobrancas ?? 0) + 1}ª cobrança): ${l.titulo}`
      break
    }
    case 'distribuir':
      texto = n > 1 ? `Distribuir as ${n} ${substantivo(mesmas, n)}` : `Distribuir: ${l.titulo}`
      break
    case 'desbloquear':
      texto = n > 1 ? `Resolver o bloqueio de ${n} ${substantivo(mesmas, n)}` : `Resolver o bloqueio: ${l.titulo}`
      break
    case 'iniciar':
      texto = n > 1 ? `Iniciar ${n} ${substantivo(mesmas, n)}` : `Iniciar: ${l.titulo}`
      break
    case 'aguardar': {
      const quem = l.esperandoDe === 'cliente' ? 'o cliente' : l.terceiroNome ? l.terceiroNome : 'o terceiro'
      texto = n > 1 ? `Aguardar retorno de ${quem} (${n} ${substantivo(mesmas, n)})` : `Aguardar retorno de ${quem}: ${l.titulo}`
      break
    }
    default:
      texto = n > 1 ? `Dar andamento a ${n} ${substantivo(mesmas, n)}` : `Dar andamento: ${l.titulo}`
  }
  return { tipo, urgencia: urgenciaDaTarefa(l), texto, tarefaId: l.taskId, responsavelId: l.responsavelId, responsavelNome: l.responsavelNome, dataPrazo: l.dataPrazo, quantas: n }
}

// ─── O PRAZO NA TABELA: "ontem" · "hoje" · "amanhã" · "dd/mm" ──────────────────────────────────────────────────────────────

export interface PrazoCurto {
  /** O texto da célula; `null` = sem prazo (a tela mostra "—"). */
  texto: string | null
  /** vermelho = já passou; ambar = vence hoje; normal = o resto. */
  tom: 'vermelho' | 'ambar' | 'normal'
}

/** O prazo em uma palavra, no dia operacional (America/Sao_Paulo) — `agora` injetável. */
export function prazoCurto(dataPrazo: string | null, agora: Date): PrazoCurto {
  if (!dataPrazo) return { texto: null, tom: 'normal' }
  const d = new Date(dataPrazo)
  if (Number.isNaN(d.getTime())) return { texto: null, tom: 'normal' }
  const dif = diasEntreDiasOperacionais(d, agora)
  if (dif === -1) return { texto: 'ontem', tom: 'vermelho' }
  if (dif === 0) return { texto: 'hoje', tom: 'ambar' }
  if (dif === 1) return { texto: 'amanhã', tom: 'normal' }
  return { texto: diaMesDoPrazo(dataPrazo), tom: dif < 0 ? 'vermelho' : 'normal' }
}
