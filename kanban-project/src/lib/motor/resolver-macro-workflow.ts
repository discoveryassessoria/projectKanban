// src/lib/motor/resolver-macro-workflow.ts
// ============================================================================
// RESOLUÇÃO DO WORKFLOW MACRO — fonte única, chamada por TODO o motor.
//
// Mandato "Reconstrução da hierarquia País/Tipo/Modalidade/Workflow Macro"
// (22/09/2026): um Tipo de Processo pode habilitar Administrativa, Judicial
// ou ambas, e cada modalidade habilitada pode ter o seu próprio Workflow
// Macro publicado (`@@unique([tipoProcessoId, modalidadeId])`). Antes desta
// mudança, `MacroWorkflow.tipoProcessoId` era `@unique` sozinho — "o macro
// deste tipo" bastava. Agora "QUAL macro" também depende da modalidade do
// PROCESSO (`Processo.modalidadeId`), e nove pontos diferentes do motor
// resolviam isso cada um com sua própria query `findUnique({where:{tipoProcessoId}})`
// — exatamente o tipo de duplicação que CLAUDE.md §7/§23 proíbe. Esta função é
// a ÚNICA fonte: todo ponto que precisa "o macro workflow aplicável" chama
// aqui, nunca replica a query.
// ============================================================================
import { prisma } from "@/lib/prisma"
import type { Prisma } from "@prisma/client"

type DB = typeof prisma | Prisma.TransactionClient

export interface MacroWorkflowAplicavel {
  id: number
  tipoProcessoId: number
  modalidadeId: number
  name: string
  ativo: boolean
  versao: number
  cardinalidadeRequerimento: string
  fases: Array<{ phaseKey: string; label: string; ordem: number; conditional: boolean; required: boolean }>
}

/**
 * O Workflow Macro aplicável a um PROCESSO real — identidade completa
 * (tipo + modalidade). É a função que `phase-advance.ts`, `criar-processo.ts`
 * e todo o resto do motor operacional devem chamar; nunca uma query própria.
 *
 * `modalidadeId == null` só é esperado para processo LEGADO (pré-migração) ou
 * ainda sem modalidade atribuída — devolve `null`, o chamador decide o motivo
 * de falha certo pro seu contexto (nunca "escolhe" uma modalidade sozinho).
 */
export async function resolverMacroWorkflowDoProcesso(
  tipoProcessoId: number | null,
  modalidadeId: number | null,
  db: DB = prisma,
): Promise<MacroWorkflowAplicavel | null> {
  if (tipoProcessoId == null || modalidadeId == null) return null
  return db.macroWorkflow.findUnique({
    where: { tipoProcessoId_modalidadeId: { tipoProcessoId, modalidadeId } },
    include: { fases: { orderBy: { ordem: "asc" }, select: { phaseKey: true, label: true, ordem: true, conditional: true, required: true } } },
  })
}

/**
 * Resolução ao nível do TIPO, sem processo/modalidade específicos —
 * usada só pelas telas de CONFIGURAÇÃO (nunca pelo motor de avanço real, que
 * sempre tem um processo com modalidade própria). Quando o Tipo habilita mais
 * de uma modalidade, devolve o Workflow Macro mais recentemente atualizado —
 * best-effort determinístico para uso administrativo (ex.: pré-visualização),
 * nunca para decidir por qual fluxo um processo real passa.
 */
export async function resolverMacroWorkflowDoTipo(
  tipoProcessoId: number,
  db: DB = prisma,
): Promise<MacroWorkflowAplicavel | null> {
  return db.macroWorkflow.findFirst({
    where: { tipoProcessoId },
    orderBy: { atualizadoEm: "desc" },
    include: { fases: { orderBy: { ordem: "asc" }, select: { phaseKey: true, label: true, ordem: true, conditional: true, required: true } } },
  })
}
