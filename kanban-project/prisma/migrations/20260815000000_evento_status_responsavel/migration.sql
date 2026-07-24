-- Evento: campos aditivos status + responsável (idempotente, uma instrução por linha)
ALTER TABLE "Evento" ADD COLUMN IF NOT EXISTS "status" VARCHAR(20) NOT NULL DEFAULT 'PENDENTE';
ALTER TABLE "Evento" ADD COLUMN IF NOT EXISTS "responsavelId" INTEGER;
CREATE INDEX IF NOT EXISTS "Evento_responsavelId_idx" ON "Evento"("responsavelId");
