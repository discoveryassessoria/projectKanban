// src/lib/home/rotulo-status-tarefa.ts
// ============================================================================
// O ESTADO DA TAREFA EM PORTUGUÊS — MAPA ÚNICO (módulo puro, sem "use client").
// Era `ROTULO_STATUS` dentro de kit-operacional.tsx (componente client): uma
// coleta de servidor (lib/home/coleta.ts) não pode importar valor de módulo
// "use client", e por isso a fila da Home montava o subtítulo com
// `statusTarefa.replace(/_/g," ").toLowerCase()` -> "nao iniciada" cru na tela.
// O kit passa a REEXPORTAR este mapa; nenhuma tela tem dicionário próprio.
//
// FONTE ÚNICA de statusTarefa -> rótulo (item B8, 30/09/2026): a coluna "Status" da Operação e da Torre
// (operacao-v3-derivacoes.ts reexporta como ROTULO_STATUS_TAREFA), a Home/fila, os avisos, o drawer do
// documento e a Central da fase leem ESTE mapa. Cobre os 9 valores do enum StatusTarefa (prisma/schema.prisma).
// NAO_INICIADA = "A iniciar". "A fazer" continua sendo o NOME DA ABA da Operação, não rótulo de status.
// ============================================================================
export const ROTULO_STATUS: Readonly<Record<string, string>> = {
  NAO_INICIADA: "A iniciar",
  EM_ANDAMENTO: "Em andamento",
  AGUARDANDO_TERCEIRO: "Aguardando terceiros",
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

/**
 * Texto de auditoria gravado pelo motor ("bloqueada (estava NAO_INICIADA)") com o estado em português na hora de MOSTRAR.
 * O que está gravado não muda; só a leitura (histórico da gaveta da Torre) troca o enum pelo rótulo oficial, em minúsculas.
 */
export function humanizarEstadosNoTexto(texto: string): string {
  return texto.replace(/\b(NAO_INICIADA|EM_ANDAMENTO|AGUARDANDO_TERCEIRO|AGUARDANDO_CLIENTE|BLOQUEADA|CONCLUIDO_RECEBIDO|CONCLUIDO_NAO_POSSUI|CANCELADA|SUPERSEDIDA)\b/g, (m) => (ROTULO_STATUS[m] ?? m).toLowerCase())
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
