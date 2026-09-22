-- Mandato "Reconstrução da hierarquia País/Tipo/Modalidade/Workflow Macro"
-- (22/09/2026) — FIX: o índice único antigo `MacroWorkflow_tipoProcessoId_key`
-- (coluna única) nunca foi trocado pelo composto `@@unique([tipoProcessoId,
-- modalidadeId])` que o schema.prisma já declarava desde o passo 1. Achado em
-- teste real de produção: criar o segundo Workflow Macro (a outra modalidade
-- do mesmo Tipo) falhava com "Unique constraint failed on (tipoProcessoId)".

BEGIN;

DROP INDEX IF EXISTS "MacroWorkflow_tipoProcessoId_key";

ALTER TABLE "MacroWorkflow"
  ADD CONSTRAINT "MacroWorkflow_tipoProcessoId_modalidadeId_key" UNIQUE ("tipoProcessoId", "modalidadeId");

COMMIT;
