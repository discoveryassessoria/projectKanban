-- Motor Financeiro V3 · Fase 2 — vencimento na obrigação (aditivo, idempotente).
ALTER TABLE "ObrigacaoEconomica" ADD COLUMN IF NOT EXISTS "vencimento" TIMESTAMP(3);
