// ============================================================================
// LÓGICA PURA DA CENTRAL OPERACIONAL (Home)
// ----------------------------------------------------------------------------
// Funções SEM dependência de banco/rede: recebem linhas simples (já lidas do
// Prisma na rota /api/home) e produzem os blocos da Home. Isto mantém a regra
// de apresentação testável sem DB (o repositório roda testes via `tsx`, sem
// runner e sem banco) e deixa a rota fina.
//
// IMPORTANTE: aqui NÃO se reimplementa regra de negócio de processo. O que
// determina "bloqueado" / "pronto para avançar" é lido do ESTADO já persistido
// (Tarefa.statusTarefa, PhaseWorkflowInstance.status, Processo.faseAtualKey).
// A decisão autoritativa de avanço continua no motor (calcularPendencias), que
// é acionado no detalhe do processo — não aqui, por custo (evita N+1).
// ============================================================================

import type {
  ActivityItem,
  AttentionSummary,
  Bottleneck,
  NivelPrioridade,
  PhaseColumn,
  PrioridadeTarefa,
} from "@/src/types/home"

// ---- Prioridade ------------------------------------------------------------
export const PESO_PRIORIDADE: Record<PrioridadeTarefa, number> = {
  URGENTE: 0,
  ALTA: 1,
  MEDIA: 2,
  BAIXA: 3,
}

export function normalizarPrioridade(p: string | null | undefined): PrioridadeTarefa {
  const v = (p ?? "").toUpperCase()
  if (v === "URGENTE" || v === "ALTA" || v === "MEDIA" || v === "BAIXA") return v
  return "MEDIA"
}

// ---- Status de tarefa ------------------------------------------------------
/** Estados que encerram a tarefa (não são "abertos"/acionáveis). */
export const STATUS_TAREFA_TERMINAL = new Set([
  "CONCLUIDO_RECEBIDO",
  "CONCLUIDO_NAO_POSSUI",
  "SUPERSEDIDA",
  "CANCELADA",
])

export interface TarefaLike {
  id: number
  concluida: boolean
  statusTarefa: string | null
  prioridade: string | null
  dataPrazo: string | Date | null
  responsavelId?: number | null
  ordem?: number | null
}

/** Tarefa "aberta": não concluída e não em estado terminal. */
export function isTarefaAberta(t: TarefaLike): boolean {
  if (t.concluida) return false
  if (t.statusTarefa && STATUS_TAREFA_TERMINAL.has(t.statusTarefa)) return false
  return true
}

/** Tarefa impeditiva (bloqueada manualmente). */
export function isTarefaBloqueada(t: TarefaLike): boolean {
  return t.statusTarefa === "BLOQUEADA"
}

// ---- Datas -----------------------------------------------------------------
export function inicioDoDia(d: Date): Date {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}
export function fimDoDia(d: Date): Date {
  const x = new Date(d)
  x.setHours(23, 59, 59, 999)
  return x
}

function prazoDate(t: TarefaLike): Date | null {
  if (!t.dataPrazo) return null
  const d = new Date(t.dataPrazo)
  return isNaN(d.getTime()) ? null : d
}

/** Tarefa aberta com prazo estritamente anterior a hoje. */
export function isVencida(t: TarefaLike, hoje: Date): boolean {
  if (!isTarefaAberta(t)) return false
  const p = prazoDate(t)
  if (!p) return false
  return inicioDoDia(p).getTime() < inicioDoDia(hoje).getTime()
}

/** Tarefa aberta com prazo == hoje. */
export function venceHoje(t: TarefaLike, hoje: Date): boolean {
  if (!isTarefaAberta(t)) return false
  const p = prazoDate(t)
  if (!p) return false
  return inicioDoDia(p).getTime() === inicioDoDia(hoje).getTime()
}

// ---- Próximas ações (ordenação) -------------------------------------------
// Ordem: 1) vencidas  2) vencem hoje  3) prioridade  4) prazo  5) ordem/id.
export function compararProximasAcoes(a: TarefaLike, b: TarefaLike, hoje: Date): number {
  const va = isVencida(a, hoje) ? 0 : 1
  const vb = isVencida(b, hoje) ? 0 : 1
  if (va !== vb) return va - vb

  const ha = venceHoje(a, hoje) ? 0 : 1
  const hb = venceHoje(b, hoje) ? 0 : 1
  if (ha !== hb) return ha - hb

  const pa = PESO_PRIORIDADE[normalizarPrioridade(a.prioridade)]
  const pb = PESO_PRIORIDADE[normalizarPrioridade(b.prioridade)]
  if (pa !== pb) return pa - pb

  const da = prazoDate(a)
  const db = prazoDate(b)
  if (da && db && da.getTime() !== db.getTime()) return da.getTime() - db.getTime()
  if (da && !db) return -1
  if (!da && db) return 1

  const oa = a.ordem ?? 0
  const ob = b.ordem ?? 0
  if (oa !== ob) return oa - ob
  return a.id - b.id
}

export function ordenarProximasAcoes<T extends TarefaLike>(tarefas: T[], hoje: Date): T[] {
  return [...tarefas].sort((a, b) => compararProximasAcoes(a, b, hoje))
}

// ---- Processos por fase ----------------------------------------------------
export interface FaseCatalogoLike {
  phaseKey: string
  label: string
  ordem: number
}

export interface PhaseCountsInput {
  catalogo: FaseCatalogoLike[]
  /** processoId -> phaseKey atual */
  faseDeProcesso: Map<number, string>
  bloqueados: Set<number>
  prontos: Set<number>
  slaVencidos: Set<number>
  /** monta o href da coluna a partir do phaseKey */
  href: (phaseKey: string) => string
  /** fases que não devem aparecer no board (ex.: finalizado) */
  ocultar?: Set<string>
}

export function agruparProcessosPorFase(input: PhaseCountsInput): PhaseColumn[] {
  const { catalogo, faseDeProcesso, bloqueados, prontos, slaVencidos, href, ocultar } = input

  // Índice fase -> coluna, na ordem do catálogo (Workflow Macro / CatalogoFase).
  const colunas = new Map<string, PhaseColumn>()
  const ordenado = [...catalogo].sort((a, b) => a.ordem - b.ordem)
  for (const f of ordenado) {
    if (ocultar?.has(f.phaseKey)) continue
    colunas.set(f.phaseKey, {
      phaseKey: f.phaseKey,
      label: f.label,
      ordem: f.ordem,
      total: 0,
      bloqueados: 0,
      prontos: 0,
      slaVencido: 0,
      href: href(f.phaseKey),
    })
  }

  for (const [processoId, phaseKey] of faseDeProcesso) {
    const col = colunas.get(phaseKey)
    if (!col) continue // fase desconhecida/oculta: não inventa coluna
    col.total += 1
    if (bloqueados.has(processoId)) col.bloqueados += 1
    if (prontos.has(processoId)) col.prontos += 1
    if (slaVencidos.has(processoId)) col.slaVencido += 1
  }

  return [...colunas.values()]
}

// ---- Resumo de atenção -----------------------------------------------------
export function calcularAttentionSummary(p: {
  processosBloqueados: number
  tarefasVencidas: number
  fasesProntas: number
  eventosHoje: number
  minhasPendencias: number
}): AttentionSummary {
  const total =
    p.processosBloqueados + p.tarefasVencidas + p.fasesProntas + p.eventosHoje + p.minhasPendencias
  return { ...p, total }
}

// ---- Gargalos --------------------------------------------------------------
// Remove zeros e ordena por impacto (quantidade desc).
export function rankBottlenecks(itens: Bottleneck[]): Bottleneck[] {
  return itens
    .filter((b) => b.quantidade > 0)
    .sort((a, b) => b.quantidade - a.quantidade)
}

export function nivelPorQuantidade(qtd: number, alto = 10, critico = 25): NivelPrioridade {
  if (qtd >= critico) return "critico"
  if (qtd >= alto) return "alto"
  if (qtd > 0) return "medio"
  return "baixo"
}

// ---- Atividade recente (limpeza de ruído) ----------------------------------
export interface LogLike {
  id: number
  acao: string
  entidade: string
  descricao: string
  criadoEm: string | Date
  usuario?: { nome: string } | null
  entidadeId?: number | null
}

/**
 * Regra de relevância da Home: mostra marcos humanos e esconde ruído técnico.
 * Ruído = edição e exclusão de TAREFA (tarefas técnicas superseded/regeneradas
 * e microedições). Tudo o mais entra.
 */
export function atividadeRelevante(l: { acao: string; entidade: string }): boolean {
  const acao = (l.acao ?? "").toLowerCase()
  const entidade = (l.entidade ?? "").toUpperCase()
  if (entidade === "TAREFA" && (acao === "editou" || acao === "excluiu")) return false
  return true
}

export function tipoAtividade(acao: string): ActivityItem["tipo"] {
  const a = (acao ?? "").toLowerCase()
  if (a === "criou") return "criacao"
  if (a === "concluiu") return "conclusao"
  if (a === "moveu") return "movimento"
  if (a.startsWith("fase")) return "fase"
  return "outro"
}

export function filtrarAtividades(logs: LogLike[]): LogLike[] {
  return logs.filter(atividadeRelevante)
}
