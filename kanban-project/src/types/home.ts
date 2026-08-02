// ============================================================================
// CONTRATO DA HOME — CENTRO OPERACIONAL (resposta de /api/home)
// ----------------------------------------------------------------------------
// CONCEITO: a Home não é dashboard nem BI. Tudo o que aparece aqui responde a
// uma pergunta operacional imediata:
//   1) O que precisa ser feito agora?   → filas (ações executáveis)
//   2) Quais são as prioridades?        → nível + ordenação das filas
//   3) Existe algum problema?           → alertas (só quando existem)
//   4) O que vence hoje?                → agenda (hoje/amanhã/próximos)
//   5) Quais filas precisam ser trabalhadas? → filas, com clique direto
//
// NÃO há receita, caixa, processos ativos, processos por fase, gargalos,
// atividade recente ou qualquer indicador histórico: isso vive nos módulos
// especializados (Financeiro, Processos, Tarefas, Relatórios).
//
// NENHUMA regra de negócio nova: os números são LIDOS do estado já persistido
// pelo motor (PhaseWorkflowStepInstance, PhaseWorkflowInstance, Tarefa,
// Documento, PendenciaFinanceira, Evento, DomainOutbox).
// ============================================================================

import type { ResumoSla } from "@/src/types/sla"

export type NivelPrioridade = "critico" | "alto" | "medio" | "baixo"

/** Módulo dono da informação — usado só para ícone/agrupamento visual. */
export type ModuloFila = "documentos" | "processos" | "tarefas" | "financeiro"

// ---- 1. Status operacional (cabeçalho) ------------------------------------
export interface StatusOperacional {
  nivel: "estavel" | "atencao" | "critico"
  /** frase curta e acionável ("3 itens exigem atenção hoje") */
  mensagem: string
  /** total de itens executáveis somando todas as filas */
  totalAcoes: number
}

// ---- 2. Central Operacional (filas de trabalho real) ----------------------
export interface FilaOperacional {
  key: string
  /** ação no infinitivo — "Solicitar certidões", não "Documentos" */
  titulo: string
  descricao: string
  quantidade: number
  nivel: NivelPrioridade
  modulo: ModuloFila
  /** drill-down: abre exatamente esta fila */
  href: string
}

/** Item individual de uma fila (drill-down /dashboard/fila/[key]). */
export interface FilaItem {
  id: string
  titulo: string
  subtitulo: string | null
  processoId: number | null
  processoCodigo: string | null
  processoNome: string | null
  pais: string | null
  prazo: string | null
  atrasado: boolean
  /** destino real do trabalho (processo/tarefa/documento/financeiro) */
  href: string
}

export interface FilaDetalhe {
  key: string
  titulo: string
  descricao: string
  nivel: NivelPrioridade
  modulo: ModuloFila
  quantidade: number
  itens: FilaItem[]
  /** true quando a fila tem mais itens do que o limite retornado */
  truncado: boolean
}

// ---- 2b. SLA dos processos (bloco de prazo) -------------------------------
// Mesma forma de FilaOperacional (card + drill-down por /dashboard/fila/[key]),
// mas fora da lista de trabalho executável: prazo não é "ação da fila", é
// situação do processo. As quatro faixas aparecem SEMPRE, inclusive zeradas.
export interface PainelSla {
  /** cards clicáveis: atrasados, vencem hoje, próximos 7 dias, no prazo */
  cards: FilaOperacional[]
  /** contagem crua da mesma leitura que gerou os cards */
  resumo: ResumoSla
}

// ---- 3. Agenda -------------------------------------------------------------
export type GrupoAgenda = "hoje" | "amanha" | "proximos"

export interface AgendaItem {
  id: number
  grupo: GrupoAgenda
  /** ISO; null quando dia inteiro */
  horario: string | null
  diaInteiro: boolean
  /** rótulo curto do dia, usado no grupo "próximos" (ex.: "sex, 24/07") */
  dia: string
  titulo: string
  tipo: string
  processoId: number | null
  processoNome: string | null
  local: string | null
  href: string
}

export interface Agenda {
  hoje: AgendaItem[]
  amanha: AgendaItem[]
  proximos: AgendaItem[]
}

// ---- 4. Alertas (só existem quando há algo crítico) -----------------------
export type TipoAlerta =
  | "prazo"
  | "documento_invalido"
  | "bloqueio"
  | "automacao"
  | "integracao"

export interface AlertaOperacional {
  key: string
  tipo: TipoAlerta
  titulo: string
  detalhe: string
  nivel: "critico" | "alto"
  quantidade: number
  href: string
}

// ---- 5. Resumo da operação do dia -----------------------------------------
export interface ResumoDia {
  tarefasConcluidas: number
  aguardandoCliente: number
  aguardandoCartorio: number
  emValidacao: number
  processosBloqueados: number
}

// ---- Permissões relevantes -------------------------------------------------
export interface HomePermissions {
  verProcessos: boolean
  verTarefas: boolean
  verEventos: boolean
  verFinanceiro: boolean
  isAdmin: boolean
}

// ---- Resposta completa -----------------------------------------------------
export interface HomeData {
  usuario: { id: number; nome: string; email: string; tipo: string }
  geradoEm: string
  permissions: HomePermissions
  status: StatusOperacional
  filas: FilaOperacional[]
  /** null quando o usuário não vê processos */
  sla: PainelSla | null
  agenda: Agenda
  /** vazio = o bloco de alertas não é renderizado */
  alertas: AlertaOperacional[]
  resumoDia: ResumoDia
}
