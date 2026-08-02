-- Motor Financeiro V3 · Fase 3 — rollback operacional da abertura (aditivo, idempotente).
ALTER TABLE "LedgerOpeningBalance" ADD COLUMN IF NOT EXISTS "revertidoEm" TIMESTAMP(3);
