// src/lib/home/rotulo-status-tarefa.ts
// ============================================================================
// O ESTADO DA TAREFA EM PORTUGUÊS — MAPA ÚNICO (módulo puro, sem "use client").
// Era `ROTULO_STATUS` dentro de kit-operacional.tsx (componente client): uma
// coleta de servidor (lib/home/coleta.ts) não pode importar valor de módulo
// "use client", e por isso a fila da Home montava o subtítulo com
// `statusTarefa.replace(/_/g," ").toLowerCase()` -> "nao iniciada" cru na tela.
// O kit passa a REEXPORTAR este mapa; nenhuma tela tem dicionário próprio.
// ============================================================================
export const ROTULO_STATUS: Record<string, string> = {
  NAO_INICIADA: "A fazer",
  EM_ANDAMENTO: "Em andamento",
  AGUARDANDO_TERCEIRO: "Aguardando terceiro",
  AGUARDANDO_CLIENTE: "Aguardando cliente",
  BLOQUEADA: "Bloqueada",
  CONCLUIDO_RECEBIDO: "Concluída",
  CONCLUIDO_NAO_POSSUI: "Concluída",
  CANCELADA: "Cancelada",
  SUPERSEDIDA: "Substituída",
}

/** Rótulo em português; status desconhecido devolve null (nunca o enum cru). */
export function rotuloStatusTarefa(status: string | null | undefined): string | null {
  if (!status) return null
  return ROTULO_STATUS[status] ?? null
}

/** Motivos de PendenciaFinanceira (varchar; ver schema) em português — a fila financeira não mostra o código cru. */
export const ROTULO_MOTIVO_PENDENCIA: Record<string, string> = {
  SEM_PRECO: "Sem preço",
  CONFLITO_PRECO: "Conflito de preço",
  NENHUMA_LINHA: "Nenhuma linha de preço",
  SEM_PRECO_VALIDO: "Sem preço válido",
}
export function rotuloMotivoPendencia(motivo: string): string {
  return ROTULO_MOTIVO_PENDENCIA[motivo] ?? "Pendência financeira"
}
