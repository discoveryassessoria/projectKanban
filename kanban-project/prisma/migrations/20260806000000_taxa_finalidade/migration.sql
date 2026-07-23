-- Finalidade do encargo (boleto): EMISSAO | PAGAMENTO | MULTA | JUROS.
-- Aditivo e idempotente (não destrutivo). Nulo para demais formas.
ALTER TABLE "TaxaPagamento" ADD COLUMN IF NOT EXISTS "finalidade" VARCHAR(20);
