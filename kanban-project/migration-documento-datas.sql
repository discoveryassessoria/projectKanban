-- Adicionar campos de data de evento e registro no Documento
ALTER TABLE "Documento" ADD COLUMN IF NOT EXISTS "data_evento" TIMESTAMP(3);
ALTER TABLE "Documento" ADD COLUMN IF NOT EXISTS "data_registro" TIMESTAMP(3);

-- Adicionar campo data_evento no Documento
ALTER TABLE "Documento" ADD COLUMN IF NOT EXISTS "data_evento" TIMESTAMP(3);