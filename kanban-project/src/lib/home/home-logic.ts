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
import { estadoTemporal } from "@/lib/operacional/tempo-operacional"

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

/**
 * Prazo já vencido — delega para a ENGINE ÚNICA (`estadoTemporal`,
 * `lib/operacional/tempo-operacional.ts`), fuso `America/Sao_Paulo`.
 *
 * Achado real (17/09/2026): esta função reimplementava a própria conta com
 * `setHours(0,0,0,0)` no fuso LOCAL DA MÁQUINA, não no operacional — a mesma
 * classe de bug que a engine única já corrigiu uma vez para outras telas
 * (duas leituras discordando perto da meia-noite). Nunca migrada até agora.
 */
export function estaAtrasado(prazo: Date | string | null | undefined, hoje: Date): boolean {
  return estadoTemporal({ dataPrazo: prazo ?? null, agora: hoje }).atrasado
}

/** Prazo é hoje — mesma engine única. */
export function venceHoje(prazo: Date | string | null | undefined, hoje: Date): boolean {
  return estadoTemporal({ dataPrazo: prazo ?? null, agora: hoje }).venceHoje
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
    // Achado real (09/09/2026): os 4 passos da Análise Documental
    // (comparar/registrar/classificar/concluir) não tinham fila própria —
    // caíam todos em "outras", um balde opaco sem filtro. São exclusivos
    // desta fase em TODO o histórico do banco (nenhum outro passo usa esses
    // verbos), então agrupar aqui não puxa nada de fora do lugar.
    key: "analise-documental",
    titulo: "Analisar documentação",
    descricao: "Comparar dados, registrar divergências e decidir retificação",
    modulo: "documentos",
    nivelBase: "alto",
    verbos: ["comparar", "registrar", "classificar", "concluir"],
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
    key: "prazos-vencendo",
    titulo: "Central de Prazos",
    descricao: "Todo passo e tarefa com prazo — filtre por atrasadas, hoje, a vencer ou um período",
    modulo: "processos",
    // "critico" só quando há atrasado de verdade — `nivelDaFila` eleva
    // dinamicamente (ver montarFilas). Sem isso, o card ficava sempre
    // vermelho mesmo quando nada estava realmente vencido (a fila agora
    // é o total de TODO prazo, não só o urgente).
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

// SLA de FaseMacro/Processo (FILAS_SLA/faixaDaFilaSla) — REMOVIDO
// (17/09/2026): terceiro relógio de prazo concorrente com os dois oficiais,
// Tarefa (macro) e Subtarefa (operacional). Ver FILAS_PRAZO_TAREFA/
// FILAS_PRAZO_SUBTAREFA abaixo e [[prazo-tarefa-subtarefa-dois-relogios]].

// ---------------------------------------------------------------------------
// FILAS DE PRAZO — Tarefa (macro) e Subtarefa (operacional), os DOIS
// controles independentes que a Home mostra lado a lado. NUNCA a mesma coisa
// que `FILAS_SLA` acima (que é FaseMacro — Processo, um terceiro relógio que
// não é apresentado como prazo operacional em lugar nenhum).
// ---------------------------------------------------------------------------
export type FaixaPrazo = "atrasadas" | "vencem-hoje" | "proximos-3" | "proximos-7" | "no-prazo"

export interface FilaPrazoDef extends FilaDef {
  faixa: FaixaPrazo
  grain: "tarefa" | "subtarefa"
}

export const FILAS_PRAZO_TAREFA: FilaPrazoDef[] = [
  { key: "tarefa-atrasadas", faixa: "atrasadas", grain: "tarefa", titulo: "Tarefas atrasadas", descricao: "Prazo macro da tarefa já vencido", modulo: "tarefas", nivelBase: "critico" },
  { key: "tarefa-vencem-hoje", faixa: "vencem-hoje", grain: "tarefa", titulo: "Tarefas — vencem hoje", descricao: "Prazo macro da tarefa termina hoje", modulo: "tarefas", nivelBase: "alto" },
  { key: "tarefa-proximos-3", faixa: "proximos-3", grain: "tarefa", titulo: "Tarefas — próximos 3 dias", descricao: "Prazo macro da tarefa nos próximos 3 dias", modulo: "tarefas", nivelBase: "medio" },
  { key: "tarefa-proximos-7", faixa: "proximos-7", grain: "tarefa", titulo: "Tarefas — próximos 7 dias", descricao: "Prazo macro da tarefa nos próximos 7 dias", modulo: "tarefas", nivelBase: "baixo" },
  { key: "tarefa-no-prazo", faixa: "no-prazo", grain: "tarefa", titulo: "Tarefas no prazo", descricao: "Dentro do prazo macro de conclusão", modulo: "tarefas", nivelBase: "baixo" },
]

export const FILAS_PRAZO_SUBTAREFA: FilaPrazoDef[] = [
  { key: "subtarefa-atrasadas", faixa: "atrasadas", grain: "subtarefa", titulo: "Subtarefas atrasadas", descricao: "SLA da ação atual já vencido", modulo: "tarefas", nivelBase: "critico" },
  { key: "subtarefa-vencem-hoje", faixa: "vencem-hoje", grain: "subtarefa", titulo: "Subtarefas — vencem hoje", descricao: "SLA da ação atual termina hoje", modulo: "tarefas", nivelBase: "alto" },
  { key: "subtarefa-proximos-3", faixa: "proximos-3", grain: "subtarefa", titulo: "Subtarefas — próximos 3 dias", descricao: "SLA da ação atual nos próximos 3 dias", modulo: "tarefas", nivelBase: "medio" },
  { key: "subtarefa-proximos-7", faixa: "proximos-7", grain: "subtarefa", titulo: "Subtarefas — próximos 7 dias", descricao: "SLA da ação atual nos próximos 7 dias", modulo: "tarefas", nivelBase: "baixo" },
  { key: "subtarefa-no-prazo", faixa: "no-prazo", grain: "subtarefa", titulo: "Subtarefas no prazo", descricao: "Dentro do SLA da ação atual", modulo: "tarefas", nivelBase: "baixo" },
]

/** A faixa/grain de prazo de uma fila; null quando a fila não é de prazo Tarefa/Subtarefa. */
export function faixaDaFilaPrazo(key: string): FilaPrazoDef | null {
  return [...FILAS_PRAZO_TAREFA, ...FILAS_PRAZO_SUBTAREFA].find((f) => f.key === key) ?? null
}

// ---------------------------------------------------------------------------
// FILAS DE ACOMPANHAMENTO — dimensão D, PRÓPRIA da espera de terceiro
// (`SubtaskExecution.proximoAcompanhamentoEm`), nunca prazo/SLA (mandato
// "correção definitiva do modelo temporal", 19-20/09/2026, seção 5/8). Uma
// subtarefa AGUARDANDO_EXTERNO nunca entra nos baldes de PRAZO
// (`FILAS_PRAZO_SUBTAREFA`, acima) — é aqui, e só aqui, que ela aparece
// quando tem acompanhamento configurado.
// ---------------------------------------------------------------------------
export const FILAS_ACOMPANHAMENTO: FilaPrazoDef[] = [
  { key: "acompanhamento-atrasados", faixa: "atrasadas", grain: "subtarefa", titulo: "Acompanhamentos atrasados", descricao: "O próximo acompanhamento já venceu", modulo: "tarefas", nivelBase: "critico" },
  { key: "acompanhamento-hoje", faixa: "vencem-hoje", grain: "subtarefa", titulo: "Acompanhar hoje", descricao: "Próximo acompanhamento programado para hoje", modulo: "tarefas", nivelBase: "alto" },
  { key: "acompanhamento-proximos-3", faixa: "proximos-3", grain: "subtarefa", titulo: "Acompanhamento — próximos 3 dias", descricao: "Próximo acompanhamento nos próximos 3 dias", modulo: "tarefas", nivelBase: "medio" },
  { key: "acompanhamento-proximos-7", faixa: "proximos-7", grain: "subtarefa", titulo: "Acompanhamento — próximos 7 dias", descricao: "Próximo acompanhamento nos próximos 7 dias", modulo: "tarefas", nivelBase: "baixo" },
  { key: "acompanhamento-aguardando", faixa: "no-prazo", grain: "subtarefa", titulo: "Aguardando — sem acompanhamento devido", descricao: "Espera de terceiro dentro do previsto", modulo: "tarefas", nivelBase: "baixo" },
]

/** A faixa/grain de acompanhamento de uma fila; null quando a fila não é de acompanhamento. */
export function faixaDaFilaAcompanhamento(key: string): FilaPrazoDef | null {
  return FILAS_ACOMPANHAMENTO.find((f) => f.key === key) ?? null
}

/** Classifica um `EstadoTemporal` já calculado numa das 5 faixas de prazo. */
export function faixaPrazoDoEstado(diasParaPrazo: number | null, atrasado: boolean): FaixaPrazo | null {
  if (diasParaPrazo == null) return null
  if (atrasado) return "atrasadas"
  if (diasParaPrazo === 0) return "vencem-hoje"
  if (diasParaPrazo <= 3) return "proximos-3"
  if (diasParaPrazo <= 7) return "proximos-7"
  return "no-prazo"
}

export const TODAS_FILAS: FilaDef[] = [...FILAS_PASSO, ...FILAS_ESTADO, ...FILAS_PRAZO_TAREFA, ...FILAS_PRAZO_SUBTAREFA, ...FILAS_ACOMPANHAMENTO]

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
