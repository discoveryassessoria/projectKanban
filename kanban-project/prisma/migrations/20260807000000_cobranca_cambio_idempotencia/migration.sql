-- Snapshot cambial completo + idempotência na Cobranca. Aditivo/idempotente.
ALTER TABLE "Cobranca" ADD COLUMN IF NOT EXISTS "moedaDestino" VARCHAR(10);
ALTER TABLE "Cobranca" ADD COLUMN IF NOT EXISTS "cotacaoTipo" VARCHAR(20);
ALTER TABLE "Cobranca" ADD COLUMN IF NOT EXISTS "cotacaoId" INTEGER;
ALTER TABLE "Cobranca" ADD COLUMN IF NOT EXISTS "cotacaoManualPorId" INTEGER;
ALTER TABLE "Cobranca" ADD COLUMN IF NOT EXISTS "cotacaoJustificativa" VARCHAR(300);
ALTER TABLE "Cobranca" ADD COLUMN IF NOT EXISTS "idempotencyKey" VARCHAR(80);
CREATE UNIQUE INDEX IF NOT EXISTS "Cobranca_idempotencyKey_key" ON "Cobranca"("idempotencyKey");
