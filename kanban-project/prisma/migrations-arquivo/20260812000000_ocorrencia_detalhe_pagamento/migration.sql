-- Motor Financeiro V3 · Fase 3 — detalhe de exibição do pagamento (aditivo, idempotente).
ALTER TABLE "OcorrenciaFinanceira" ADD COLUMN IF NOT EXISTS "formaLabel" VARCHAR(40);
ALTER TABLE "OcorrenciaFinanceira" ADD COLUMN IF NOT EXISTS "contaBanco" VARCHAR(80);
ALTER TABLE "OcorrenciaFinanceira" ADD COLUMN IF NOT EXISTS "contaAgencia" VARCHAR(20);
ALTER TABLE "OcorrenciaFinanceira" ADD COLUMN IF NOT EXISTS "contaNumero" VARCHAR(30);
ALTER TABLE "OcorrenciaFinanceira" ADD COLUMN IF NOT EXISTS "referencia" VARCHAR(120);
