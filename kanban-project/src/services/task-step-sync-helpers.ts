// src/services/task-step-sync-helpers.ts
// CP-4D — helpers PUROS da sincronização Tarefa↔Passo (sem prisma/sem alias @/).
// Precedência de conflito, validade de transição, chaves idempotentes, políticas.

export type Origem = "USER" | "MOTOR" | "TASK" | "STEP" | "SYNC" | "SYSTEM" | "MIGRACAO"

export type FailureCodeD =
  | "STEP_NAO_ENCONTRADO"
  | "TAREFA_NAO_ENCONTRADA"
  | "RUNTIME_V2_DESABILITADO"
  | "PROCESSO_LEGACY"
  | "SEM_STEP_INSTANCE"
  | "TRANSICAO_INVALIDA"
  | "CONFLITO"
  | "SEGREGACAO_VIOLADA"
  | "MOTIVO_OBRIGATORIO"
  | "POLITICA_INVALIDA"
  | "NAO_AGUARDANDO_APROVACAO"
  | "CONFIGURACAO_INVALIDA"
  // A etapa depende de outra que ainda não foi cumprida. Não é transição inválida —
  // o estado de origem permitia; o que não permite é o roteiro.
  | "DEPENDENCIA_PENDENTE"

export interface SyncIssue { code: string; message: string }

// Precedência conceitual aprovada:
// SUPERSEDIDO > CANCELADO > DISPENSADO > CONCLUIDO > BLOQUEADO > EM_ANDAMENTO > DISPONIVEL > PENDENTE
export const PRECEDENCIA_PASSO: Record<string, number> = {
  SUPERSEDIDO: 7, FALHOU: 7, CANCELADO: 6, DISPENSADO: 5,
  CONCLUIDO: 4, EXECUTADO: 4, AGUARDANDO_APROVACAO: 4,
  BLOQUEADO: 3, EM_ANDAMENTO: 2, AGUARDANDO: 2, DISPONIVEL: 1, PENDENTE: 0,
}
export const PRECEDENCIA_TAREFA: Record<string, number> = {
  SUPERSEDIDA: 7, CANCELADA: 6, CONCLUIDO_RECEBIDO: 4, CONCLUIDO_NAO_POSSUI: 4,
  BLOQUEADA: 3, EM_ANDAMENTO: 2, AGUARDANDO_CLIENTE: 2, AGUARDANDO_TERCEIRO: 2, NAO_INICIADA: 0,
}

export function ehTerminalPasso(s: string): boolean {
  return ["SUPERSEDIDO", "CANCELADO", "DISPENSADO", "CONCLUIDO", "FALHOU"].includes(s)
}
export function ehTerminalTarefa(s: string): boolean {
  return ["SUPERSEDIDA", "CANCELADA", "CONCLUIDO_RECEBIDO", "CONCLUIDO_NAO_POSSUI"].includes(s)
}

/**
 * Transição geral por precedência: no-op (igual) ou subir de precedência.
 * Terminais não podem ser sobrescritos por estado INFERIOR; um estado SUPERIOR
 * (ex.: SUPERSEDIDO sobre CONCLUIDO) é permitido. Desbloqueio (descida) é tratado
 * à parte (restauração explícita), não por esta função.
 */
// Transições especiais permitidas independentemente da precedência
// (fluxo de aprovação e desbloqueio — descidas/laterais controladas).
const ESPECIAIS_PASSO: [string, string][] = [
  ["EXECUTADO", "AGUARDANDO_APROVACAO"],
  ["AGUARDANDO_APROVACAO", "CONCLUIDO"],
  ["BLOQUEADO", "DISPONIVEL"], ["BLOQUEADO", "EM_ANDAMENTO"], ["BLOQUEADO", "AGUARDANDO"],
]
const ESPECIAIS_TAREFA: [string, string][] = [
  ["BLOQUEADA", "NAO_INICIADA"], ["BLOQUEADA", "EM_ANDAMENTO"],
  ["BLOQUEADA", "AGUARDANDO_CLIENTE"], ["BLOQUEADA", "AGUARDANDO_TERCEIRO"],
]

export function podeAplicarPasso(atual: string, alvo: string): boolean {
  if (atual === alvo) return true
  if (ESPECIAIS_PASSO.some(([a, b]) => a === atual && b === alvo)) return true
  return (PRECEDENCIA_PASSO[alvo] ?? -1) > (PRECEDENCIA_PASSO[atual] ?? -1)
}
export function podeAplicarTarefa(atual: string, alvo: string): boolean {
  if (atual === alvo) return true
  if (ESPECIAIS_TAREFA.some(([a, b]) => a === atual && b === alvo)) return true
  return (PRECEDENCIA_TAREFA[alvo] ?? -1) > (PRECEDENCIA_TAREFA[atual] ?? -1)
}

/**
 * A TENTATIVA FAZ PARTE DA IDENTIDADE DA TRANSIÇÃO.
 *
 * `ciclo` distingue execuções diferentes da mesma fase, mas NÃO distingue duas
 * passagens pelo mesmo passo dentro do mesmo ciclo — e é exatamente isso que a
 * REABERTURA cria: o cartório manda o documento errado, a etapa volta, o
 * operador refaz e conclui de novo. Sem discriminador, a segunda conclusão
 * produzia a mesma `chaveIdempotencia` da primeira e a transação inteira caía
 * com P2002. O trabalho estava certo; a chave é que descrevia mal o fato.
 *
 * O `lockVersion` da linha no momento da leitura é o discriminador natural:
 * ele muda a cada transição aplicada, então cada passagem tem identidade
 * própria. E ele não enfraquece a idempotência — um reenvio do MESMO comando
 * para em `status === alvo` antes de chegar aqui, e duas gravações concorrentes
 * já são resolvidas pelo CAS, onde só uma casa o lockVersion lido.
 */
function sufixoTentativa(tentativa?: number): string {
  return tentativa === undefined ? "" : `|t${tentativa}`
}

/** Chave idempotente do comando (determinística). */
export function chaveComando(op: string, entityType: string, entityId: number, alvo: string, ciclo: number, tentativa?: number): string {
  return `${op}|${entityType}${entityId}|${alvo}|c${ciclo}${sufixoTentativa(tentativa)}`
}
/** Chave única do evento derivada do comando. */
export function chaveEvento(tipo: string, entityType: string, entityId: number, alvo: string, ciclo: number, tentativa?: number): string {
  return `evt|${tipo}|${entityType}${entityId}|${alvo}|c${ciclo}${sufixoTentativa(tentativa)}`
}

// ---- Restauração de bloqueio (decisão 6) ----
const RESTORE_VALIDOS_PASSO = ["DISPONIVEL", "EM_ANDAMENTO", "AGUARDANDO"]
export function restaurarStatusPasso(anterior: string | null | undefined): string {
  return anterior && RESTORE_VALIDOS_PASSO.includes(anterior) ? anterior : "DISPONIVEL"
}
const RESTORE_VALIDOS_TAREFA = ["NAO_INICIADA", "EM_ANDAMENTO", "AGUARDANDO_CLIENTE", "AGUARDANDO_TERCEIRO"]
export function restaurarStatusTarefa(anterior: string | null | undefined): string {
  return anterior && RESTORE_VALIDOS_TAREFA.includes(anterior) ? anterior : "NAO_INICIADA"
}

// ---- Política de cancelamento (decisão 4) — destino explícito, nunca inferido ----
export type PoliticaCancelamento = "REFAZER" | "INVALIDO" | "SUPERSESSAO" | "ADMINISTRATIVO"

export interface DestinoCancelamento {
  tarefaAlvo: "CANCELADA" | "SUPERSEDIDA"
  passoAlvo: "DISPONIVEL" | "BLOQUEADO" | "CANCELADO" | "SUPERSEDIDO" | null // null = não altera o Passo
}
export function destinoCancelamentoTarefa(politica: PoliticaCancelamento): DestinoCancelamento {
  switch (politica) {
    case "REFAZER": return { tarefaAlvo: "CANCELADA", passoAlvo: "DISPONIVEL" }
    case "INVALIDO": return { tarefaAlvo: "CANCELADA", passoAlvo: "BLOQUEADO" }
    case "SUPERSESSAO": return { tarefaAlvo: "SUPERSEDIDA", passoAlvo: "SUPERSEDIDO" }
    case "ADMINISTRATIVO": return { tarefaAlvo: "CANCELADA", passoAlvo: null }
  }
}
