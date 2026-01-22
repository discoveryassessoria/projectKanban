-- Adicionar campos de follow-up na tabela Tarefa
ALTER TABLE "Tarefa" ADD COLUMN IF NOT EXISTS "dataInicio" TIMESTAMP;
ALTER TABLE "Tarefa" ADD COLUMN IF NOT EXISTS "observacoes" TEXT;
ALTER TABLE "Tarefa" ADD COLUMN IF NOT EXISTS "tipoSubtarefa" VARCHAR(20);
ALTER TABLE "Tarefa" ADD COLUMN IF NOT EXISTS "prazoCobranca" INTEGER DEFAULT 5;