-- CodeGeneratorService (aditivo, não destrutivo).
-- Sequências de código público (contador atômico, sem reuso) + código público do Processo.
-- UUIDs/ids técnicos e relações NÃO mudam. Backfill dos códigos antigos é feito por script
-- idempotente (backfill-codigos-publicos.ts), preservando tudo.

CREATE TABLE IF NOT EXISTS "CodeSequence" (
  "id" SERIAL PRIMARY KEY,
  "scope" VARCHAR(40) NOT NULL,
  "ultimo" INTEGER NOT NULL DEFAULT 0,
  "atualizadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "CodeSequence_scope_key" ON "CodeSequence"("scope");

ALTER TABLE "Processo" ADD COLUMN IF NOT EXISTS "codigo" VARCHAR(20);
CREATE UNIQUE INDEX IF NOT EXISTS "Processo_codigo_key" ON "Processo"("codigo");
