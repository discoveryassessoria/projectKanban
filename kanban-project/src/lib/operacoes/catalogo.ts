// src/lib/operacoes/catalogo.ts
//
// CATÁLOGO OPERACIONAL — registro dos adaptadores. Resolver por LOOKUP (registry[type]), nunca
// por switch de negócio. Adicionar um tipo operacional = criar um adaptador e registrá-lo aqui;
// a tela de criação, a Central e a reconciliação passam a suportá-lo AUTOMATICAMENTE.

import type { CatalogoItem, ExecutionAdapter } from "./tipos"
import { documentoAdapter } from "./adapters/documento"

// Registro dinâmico. Novos adaptadores entram nesta lista — nada mais muda.
const ADAPTERS: ExecutionAdapter[] = [documentoAdapter]

/** Adaptador ativo para um tipo operacional (ou null se inexistente/inativo). */
export function getAdapter(operationType: string): ExecutionAdapter | null {
  return ADAPTERS.find((a) => a.operationType === operationType && a.active) ?? null
}

/** Itens elegíveis para Operação Antecipada (executáveis fora da fase). Consumido pela UI, que
 *  GERA o formulário a partir destes metadados (sem lista fixa / sem condicionar por fase). */
export function listCatalogo(): CatalogoItem[] {
  return ADAPTERS.filter((a) => a.active && a.canRunOutsidePhase).map((a) => ({
    operationType: a.operationType,
    label: a.label,
    canRunOutsidePhase: a.canRunOutsidePhase,
    allowAdvanceExecution: a.allowAdvanceExecution,
    workflowDefinitionId: a.workflowDefinitionId,
    exigeTipoDocumento: a.exigeTipoDocumento,
    exigePessoa: a.exigePessoa,
    permiteReutilizarExistente: a.permiteReutilizarExistente,
    permiteCriarNovo: a.permiteCriarNovo,
    camposAdicionais: a.camposAdicionais,
    resultStrategy: a.resultInterpreter,
    reconciliationStrategy: a.reconciliationStrategy,
  }))
}
