// ============================================================================
// LÓGICA PURA DO CENTRO OPERACIONAL (Home)
// ----------------------------------------------------------------------------
// Sem banco, sem rede: recebe linhas simples (já lidas pelo coletor) e produz
// filas, status, agenda e alertas. Mantém a Home testável sem DB (`tsx`).
//
// REGRA DE OURO: aqui NÃO se reimplementa regra de negócio. "Bloqueado",
// "pronto", "aberto", "concluído" são LIDOS do estado persistido pelo motor
// (PhaseWorkflowStepInstance.status, PhaseWorkflowInstance.status,
// Tarefa.statusTarefa, Documento.status, PendenciaFinanceira.resolvida). Esta
// camada só classifica, agrupa e ordena para a triagem da manhã.
// ============================================================================

import type {
  FilaOperacional,
  GrupoAgenda,
  ModuloFila,
  NivelPrioridade,
  StatusOperacional,
} from "@/src/types/home"
import type { FaixaSla } from "@/src/types/sla"

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
export function somarDias(d: Date, dias: number): Date {
  const x = new Date(d)
  x.setDate(x.getDate() + dias)
  return x
}
/** Diferença em dias inteiros entre dois instantes (a - b), por dia civil. */
export function diasEntre(a: Date, b: Date): number {
  return Math.round((inicioDoDia(a).getTime() - inicioDoDia(b).getTime()) / 86_400_000)
}

/** Prazo já vencido (dia civil anterior a hoje). */
export function estaAtrasado(prazo: Date | string | null | undefined, hoje: Date): boolean {
  if (!prazo) return false
  const d = new Date(prazo)
  if (isNaN(d.getTime())) return false
  return inicioDoDia(d).getTime() < inicioDoDia(hoje).getTime()
}

/** Prazo é hoje. */
export function venceHoje(prazo: Date | string | null | undefined, hoje: Date): boolean {
  if (!prazo) return false
  const d = new Date(prazo)
  if (isNaN(d.getTime())) return false
  return inicioDoDia(d).getTime() === inicioDoDia(hoje).getTime()
}

// ---- Estados lidos do motor ------------------------------------------------
/** Estados que encerram a tarefa — não são trabalho aberto. */
export const STATUS_TAREFA_TERMINAL = new Set([
  "CONCLUIDO_RECEBIDO",
  "CONCLUIDO_NAO_POSSUI",
  "SUPERSEDIDA",
  "CANCELADA",
])

/** Passos que ainda representam trabalho vivo (inclui AGUARDANDO e BLOQUEADO). */
export const STATUS_PASSO_VIVO = [
  "PENDENTE",
  "DISPONIVEL",
  "EM_ANDAMENTO",
  "AGUARDANDO",
  "BLOQUEADO",
] as const

/** Passos em que existe ação executável AGORA (aguardar não é ação). */
export const STATUS_PASSO_ACIONAVEL = new Set(["PENDENTE", "DISPONIVEL", "EM_ANDAMENTO"])

// ---- Classificação de trabalho por verbo do passo --------------------------
// O stepKey do catálogo de fases é sempre `verbo_complemento`
// (solicitar_certidao, conferir_apostilas, montar_pasta_traducao...). A fila é
// derivada do VERBO — data-driven, sem condicional por fase e sem lista fixa de
// stepKeys que quebraria ao cadastrar uma fase nova.
export function verboDoStep(stepKey: string): string {
  return (stepKey ?? "").split("_")[0].toLowerCase()
}

export interface FilaDef {
  key: string
  titulo: string
  descricao: string
  modulo: ModuloFila
  nivelBase: NivelPrioridade
  /** verbos de stepKey que caem nesta fila (apenas filas de passo) */
  verbos?: string[]
}

/** Filas derivadas dos passos do Workflow (trabalho real do motor). */
export const FILAS_PASSO: FilaDef[] = [
  {
    key: "solicitar",
    titulo: "Solicitar certidões",
    descricao: "Requerimentos prontos para envio ao cartório",
    modulo: "documentos",
    nivelBase: "alto",
    verbos: ["solicitar"],
  },
  {
    key: "localizar",
    titulo: "Localizar registros",
    descricao: "Registros civis a localizar antes da emissão",
    modulo: "documentos",
    nivelBase: "medio",
    verbos: ["localizar"],
  },
  {
    key: "receber",
    titulo: "Registrar documentos recebidos",
    descricao: "Retornos do cartório aguardando upload e registro",
    modulo: "documentos",
    nivelBase: "alto",
    verbos: ["receber"],
  },
  {
    key: "conferir",
    titulo: "Conferir documentos",
    descricao: "Inspeção operacional antes da validação jurídica",
    modulo: "documentos",
    nivelBase: "alto",
    verbos: ["conferir"],
  },
  {
    key: "validar",
    titulo: "Validar documentos",
    descricao: "Decisão jurídica final do documento",
    modulo: "documentos",
    nivelBase: "alto",
    verbos: ["validar"],
  },
  {
    key: "preparar",
    titulo: "Preparar e enviar pastas",
    descricao: "Montagem e envio para tradução, apostila e retificação",
    modulo: "processos",
    nivelBase: "medio",
    verbos: ["montar", "enviar"],
  },
  {
    key: "protocolar",
    titulo: "Protocolar processos",
    descricao: "Dossiês prontos para agendamento e protocolo",
    modulo: "processos",
    nivelBase: "alto",
    verbos: ["protocolar", "agendar"],
  },
  {
    key: "acompanhar",
    titulo: "Acompanhar retificações",
    descricao: "Estratégia, andamento e decisões de retificação",
    modulo: "processos",
    nivelBase: "medio",
    verbos: ["definir", "acompanhar"],
  },
  {
    key: "outras",
    titulo: "Outras ações do workflow",
    descricao: "Passos executáveis fora das filas acima",
    modulo: "processos",
    nivelBase: "baixo",
  },
]

/** Filas que não vêm de passo (estado próprio já persistido). */
export const FILAS_ESTADO: FilaDef[] = [
  {
    key: "bloqueios",
    titulo: "Resolver bloqueios",
    descricao: "Passos e tarefas travados por impedimento",
    modulo: "processos",
    nivelBase: "critico",
  },
  {
    key: "tarefas-vencidas",
    titulo: "Tarefas vencidas",
    descricao: "Prazo expirado — exigem ação imediata",
    modulo: "tarefas",
    nivelBase: "critico",
  },
  {
    key: "tarefas-hoje",
    titulo: "Tarefas que vencem hoje",
    descricao: "Precisam ser fechadas até o fim do dia",
    modulo: "tarefas",
    nivelBase: "alto",
  },
  {
    key: "aguardando-cliente",
    titulo: "Documentos aguardando cliente",
    descricao: "Follow-up pendente com o cliente",
    modulo: "tarefas",
    nivelBase: "medio",
  },
  {
    key: "sem-responsavel",
    titulo: "Processos sem responsável",
    descricao: "Trabalho aberto sem dono definido",
    modulo: "processos",
    nivelBase: "alto",
  },
  {
    key: "processos-parados",
    titulo: "Processos parados",
    descricao: "Sem movimentação há mais de 15 dias",
    modulo: "processos",
    nivelBase: "alto",
  },
  {
    key: "avancar-fase",
    titulo: "Avançar fase concluída",
    descricao: "Workflow interno concluído, aguardando avanço",
    modulo: "processos",
    nivelBase: "alto",
  },
  {
    key: "pendencias-financeiras",
    titulo: "Regularizar pendências financeiras",
    descricao: "Lançamentos que não puderam ser gerados",
    modulo: "financeiro",
    nivelBase: "alto",
  },
]

/**
 * Filas de SLA — uma por faixa de prazo do processo. Não são "trabalho
 * executável" (por isso ficam FORA da Central Operacional de filas e não passam
 * por `ordenarFilas`): formam o bloco próprio de prazo da Home, sempre com as
 * quatro faixas visíveis, inclusive zeradas — "0 atrasados" é informação.
 *
 * A faixa é a MESMA calculada pela engine (sla-core.faixaSla): o card e o
 * drill-down leem o mesmo objeto, então a contagem nunca diverge da lista.
 */
export interface FilaSlaDef extends FilaDef {
  faixa: FaixaSla
}

export const FILAS_SLA: FilaSlaDef[] = [
  {
    key: "sla-atrasados",
    faixa: "atrasados",
    titulo: "Processos atrasados",
    descricao: "Prazo previsto de conclusão já vencido",
    modulo: "processos",
    nivelBase: "critico",
  },
  {
    key: "sla-vencem-hoje",
    faixa: "vencem-hoje",
    titulo: "Vencem hoje",
    descricao: "Prazo previsto de conclusão termina hoje",
    modulo: "processos",
    nivelBase: "alto",
  },
  {
    key: "sla-proximos-7",
    faixa: "proximos-7",
    titulo: "Vencem nos próximos 7 dias",
    descricao: "Janela de atenção do prazo do processo",
    modulo: "processos",
    nivelBase: "alto",
  },
  {
    key: "sla-no-prazo",
    faixa: "no-prazo",
    titulo: "No prazo",
    descricao: "Processos dentro do prazo contratado",
    modulo: "processos",
    nivelBase: "baixo",
  },
]

/** Faixa de SLA atendida por uma fila; null quando a fila não é de SLA. */
export function faixaDaFilaSla(key: string): FaixaSla | null {
  return FILAS_SLA.find((f) => f.key === key)?.faixa ?? null
}

export const TODAS_FILAS: FilaDef[] = [...FILAS_PASSO, ...FILAS_ESTADO, ...FILAS_SLA]

const FILA_POR_VERBO = new Map<string, string>()
for (const f of FILAS_PASSO) for (const v of f.verbos ?? []) FILA_POR_VERBO.set(v, f.key)

/** Fila de destino de um passo executável — pelo verbo, com fallback "outras". */
export function filaDoStepKey(stepKey: string): string {
  return FILA_POR_VERBO.get(verboDoStep(stepKey)) ?? "outras"
}

/** Verbo que representa espera de terceiro (não é ação da equipe). */
export function ehPassoDeEspera(stepKey: string): boolean {
  return verboDoStep(stepKey) === "aguardar"
}

export function acharFila(key: string): FilaDef | undefined {
  return TODAS_FILAS.find((f) => f.key === key)
}

// ---- Nível / prioridade ----------------------------------------------------
const PESO_NIVEL: Record<NivelPrioridade, number> = { critico: 0, alto: 1, medio: 2, baixo: 3 }

/**
 * Prioridade final da fila: o nível base do tipo de trabalho, escalado para
 * "crítico" quando existe item atrasado. Volume NÃO define prioridade — 40
 * certidões no prazo continuam sendo rotina; 1 atrasada é problema.
 */
export function nivelDaFila(nivelBase: NivelPrioridade, atrasados: number): NivelPrioridade {
  if (atrasados > 0) return "critico"
  return nivelBase
}

/** Filas vazias somem; ordena por prioridade e, dentro dela, por volume. */
export function ordenarFilas(filas: FilaOperacional[]): FilaOperacional[] {
  return filas
    .filter((f) => f.quantidade > 0)
    .sort(
      (a, b) =>
        PESO_NIVEL[a.nivel] - PESO_NIVEL[b.nivel] ||
        b.quantidade - a.quantidade ||
        a.titulo.localeCompare(b.titulo, "pt-BR"),
    )
}

// ---- Status operacional do cabeçalho --------------------------------------
export function montarStatus(p: {
  totalAcoes: number
  criticos: number
  alertas: number
}): StatusOperacional {
  const { totalAcoes, criticos, alertas } = p
  if (totalAcoes === 0 && alertas === 0) {
    return { nivel: "estavel", mensagem: "Operação em dia — nada exige ação agora.", totalAcoes: 0 }
  }
  if (criticos > 0 || alertas > 0) {
    const n = criticos + alertas
    return {
      nivel: "critico",
      mensagem: `${n} ${n === 1 ? "item exige" : "itens exigem"} atenção imediata`,
      totalAcoes,
    }
  }
  return {
    nivel: "atencao",
    mensagem: `${totalAcoes} ${totalAcoes === 1 ? "ação pendente" : "ações pendentes"} nas filas`,
    totalAcoes,
  }
}

// ---- Agenda ----------------------------------------------------------------
export function grupoDaData(data: Date | string, hoje: Date): GrupoAgenda | null {
  const d = new Date(data)
  if (isNaN(d.getTime())) return null
  const delta = diasEntre(d, hoje)
  if (delta < 0) return null
  if (delta === 0) return "hoje"
  if (delta === 1) return "amanha"
  return "proximos"
}

export function rotuloDoDia(data: Date | string): string {
  const d = new Date(data)
  if (isNaN(d.getTime())) return ""
  return d.toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit" })
}
