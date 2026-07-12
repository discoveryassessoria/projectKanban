// src/services/operational-workflow-helpers.ts
// CP-4G — helpers PUROS (sem prisma / sem alias @/) do dual-read canônico.
// Formato unificado consumido pela UI, independente do runtime (legacy|v2).

export type RuntimeSource = "v2" | "legacy" | "legacy-fallback" | "none"

export interface OperationalPasso {
  id: number
  stepKey: string
  ordem: number
  tipo: string
  status: string
  obrigatorio: boolean
  responsavelId: number | null
  prioridade: string | null
  prazo: string | null
  bloqueadoManual: boolean
  necessidadeId: number | null
  documentoId: number | null
}

export interface OperationalTarefa {
  id: number
  titulo: string
  statusTarefa: string
  responsavelId: number | null
  prioridade: string
  dataPrazo: string | null
  stepInstanceId: number | null
  necessidadeId: number | null
  documentoId: number | null
}

export interface OperationalNecessidade {
  id: number
  status: string
  obrigatoriedade: string
  itemCatalogoId: number
}

export interface OperationalDocumento {
  id: number
  tipo: string | null
  status: string
}

export interface OperationalPendencia {
  code: string
  category: string
  severity: string
  message: string
  entityType?: string
  entityId?: number | string
}

export interface OperationalWorkflowView {
  processoId: number
  runtime: "legacy" | "v2"
  killSwitchGlobal: boolean
  faseAtual: string
  ciclo: number | null
  workflow: {
    instanceId: number | null
    workflowDefinitionId: number | null
    workflowVersion: number | null
    macroWorkflowId: number | null
    macroVersion: number | null
    status: string | null
  } | null
  passos: OperationalPasso[]
  tarefas: OperationalTarefa[]
  necessidades: OperationalNecessidade[]
  documentos: OperationalDocumento[]
  pendencias: {
    blocking: OperationalPendencia[]
    warnings: OperationalPendencia[]
    canAdvance: boolean
    policy: string
  }
  versoes: { macro: number | null; interno: number | null }
  source: RuntimeSource
  warnings: string[]
}

/** ISO string ou null a partir de Date | null (puro/determinístico). */
export function iso(d: Date | null | undefined): string | null {
  return d ? d.toISOString() : null
}

/**
 * Warnings de diagnóstico do dual-read, coerentes com a decisão de runtime:
 *  - v2 com kill switch OFF → aviso claro de que o runtime v2 está desligado;
 *  - v2 sem instância ativa → fallback histórico;
 *  - legacy → leitura legada, sem escrita v2.
 */
export function montarWarnings(input: {
  runtime: "legacy" | "v2"
  killSwitchGlobal: boolean
  temInstanciaV2: boolean
}): { warnings: string[]; source: RuntimeSource } {
  const warnings: string[] = []
  if (input.runtime === "v2") {
    if (!input.killSwitchGlobal) {
      warnings.push("Runtime v2 marcado no processo, mas o kill switch global está DESLIGADO (leitura efetiva = legacy).")
      return { warnings, source: "legacy" }
    }
    if (!input.temInstanciaV2) {
      warnings.push("Runtime v2 ativo, porém sem instância de fase — exibindo fallback histórico/legacy.")
      return { warnings, source: "legacy-fallback" }
    }
    return { warnings, source: "v2" }
  }
  warnings.push("Processo em runtime legacy: leitura legada; nenhuma escrita v2 é feita.")
  return { warnings, source: "legacy" }
}
