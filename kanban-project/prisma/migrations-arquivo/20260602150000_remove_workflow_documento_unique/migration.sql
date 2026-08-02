-- Migration: remove_workflow_documento_unique
-- Remove a restrição UNIQUE de Workflow.documentoId.
--
-- POR QUÊ: no modelo workflow-por-fase, um documento tem VÁRIOS workflows
-- ao longo do tempo (um por fase; os de fases concluídas ficam arquivados
-- como histórico). A restrição @unique permitia só um workflow por documento,
-- o que impedia criar o workflow da próxima fase ao avançar.
--
-- SEGURO: só REMOVE uma restrição, não apaga dados. Os workflows existentes
-- continuam todos lá. O índice que dava suporte ao unique também é removido.
--
-- NOTA: o nome exato da constraint/índice pode variar. O Prisma normalmente
-- nomeia como "Workflow_documentoId_key". Os DROP usam IF EXISTS pra não
-- quebrar caso o nome seja outro — se nenhum cair, ver o nome real com:
--   SELECT conname FROM pg_constraint WHERE conrelid = '"Workflow"'::regclass;

-- Remove a constraint unique (nome padrão do Prisma)
ALTER TABLE "public"."Workflow" DROP CONSTRAINT IF EXISTS "Workflow_documentoId_key";

-- Remove o índice unique associado, se tiver ficado como índice separado
DROP INDEX IF EXISTS "public"."Workflow_documentoId_key";

-- Recria um índice NÃO-único em documentoId (pra buscas continuarem rápidas).
-- O schema já declara @@index([documentoId]); este garante que ele exista
-- como índice comum mesmo após remover o unique.
CREATE INDEX IF NOT EXISTS "Workflow_documentoId_idx" ON "public"."Workflow"("documentoId");