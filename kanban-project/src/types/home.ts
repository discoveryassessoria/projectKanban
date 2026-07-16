// ============================================================================
// Contrato da CENTRAL OPERACIONAL (Home) — resposta agregada de /api/home
// ----------------------------------------------------------------------------
// Este arquivo define APENAS o formato dos dados que a Home consome. Nenhuma
// regra de negócio dos processos vive aqui: o backend lê o estado já
// persistido (faseAtualKey, statusTarefa, PhaseWorkflowInstance.status, etc.)
// e monta estes blocos. A Home é uma superfície de triagem; a decisão
// autoritativa (ex.: pendências reais de avanço de fase) continua no detalhe
// do processo.
// ============================================================================

export type NivelPrioridade = "critico" | "alto" | "medio" | "baixo"

/** Prioridade de tarefa (espelha o enum PrioridadeTarefa do Prisma). */
export type PrioridadeTarefa = "URGENTE" | "ALTA" | "MEDIA" | "BAIXA"

// ---- 1. Cabeçalho / resumo de atenção -------------------------------------
export interface AttentionSummary {
  /** Total de itens realmente acionáveis (soma dos componentes abaixo). */
  total: number
  processosBloqueados: number
  tarefasVencidas: number
  fasesProntas: number
  eventosHoje: number
  minhasPendencias: number
}

// ---- 2. Alertas prioritários ----------------------------------------------
export interface PriorityAlert {
  key: string
  titulo: string
  descricao: string
  quantidade: number
  nivel: NivelPrioridade
  /** destino já filtrado (rota interna com querystring) */
  href: string
}

// ---- 3. Próximas ações -----------------------------------------------------
export interface NextAction {
  id: number
  titulo: string
  processoId: number | null
  processoNome: string | null
  familiaNome: string | null
  faseLabel: string | null
  responsavelNome: string | null
  prazo: string | null
  prioridade: PrioridadeTarefa
  status: string
  vencida: boolean
  venceHoje: boolean
  href: string
}

// ---- 4. Fila da equipe -----------------------------------------------------
export interface TeamQueueGroup {
  key: string
  nome: string
  /** true para o grupo "Minhas pendências" (destaque no topo) */
  ehMinhas: boolean
  /** true para o grupo "Sem responsável" */
  semResponsavel: boolean
  pendentes: number
  vencidas: number
  criticas: number
  href: string
}

// ---- 5. Processos por fase -------------------------------------------------
export interface PhaseColumn {
  phaseKey: string
  label: string
  ordem: number
  total: number
  bloqueados: number
  prontos: number
  slaVencido: number
  href: string
}

// ---- 6. Gargalos -----------------------------------------------------------
export interface Bottleneck {
  key: string
  titulo: string
  quantidade: number
  nivel: NivelPrioridade
  href: string
}

// ---- 7. Agenda de hoje -----------------------------------------------------
export interface AgendaItem {
  id: number
  horario: string | null
  diaInteiro: boolean
  titulo: string
  tipo: string
  processoId: number | null
  processoNome: string | null
  local: string | null
  href: string
}

// ---- 8. Atividade recente --------------------------------------------------
export interface ActivityItem {
  id: string
  acao: string
  entidade: string
  descricao: string
  usuarioNome: string | null
  quando: string
  tipo: "criacao" | "conclusao" | "movimento" | "fase" | "outro"
  href: string | null
}

// ---- Permissões relevantes à Home -----------------------------------------
export interface HomePermissions {
  verProcessos: boolean
  verTarefas: boolean
  verEventos: boolean
  criarProcesso: boolean
  criarTarefa: boolean
  isAdmin: boolean
}

// ---- Resposta completa -----------------------------------------------------
export interface HomeData {
  usuario: { id: number; nome: string; email: string; tipo: string }
  geradoEm: string
  permissions: HomePermissions
  attentionSummary: AttentionSummary
  priorityAlerts: PriorityAlert[]
  nextActions: NextAction[]
  nextActionsTotal: number
  teamQueue: TeamQueueGroup[]
  processesByPhase: PhaseColumn[]
  bottlenecks: Bottleneck[]
  todayAgenda: AgendaItem[]
  recentActivity: ActivityItem[]
}
