-- Migration ADITIVA — Forma de Pagamento: direção de uso, adquirente e parcela mínima.
-- MoedaCadastro: flag de ativação. 100% idempotente (ADD COLUMN IF NOT EXISTS),
-- nenhum drop, nenhum backfill destrutivo. Defaults preservam o comportamento atual
-- de todos os registros já cadastrados.

ALTER TABLE "FormaPagamentoCadastro" ADD COLUMN IF NOT EXISTS "minParcelas" INTEGER DEFAULT 1;
ALTER TABLE "FormaPagamentoCadastro" ADD COLUMN IF NOT EXISTS "exigeAdquirente" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "FormaPagamentoCadastro" ADD COLUMN IF NOT EXISTS "usoRecebimento" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "FormaPagamentoCadastro" ADD COLUMN IF NOT EXISTS "usoPagamento" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "MoedaCadastro" ADD COLUMN IF NOT EXISTS "ativo" BOOLEAN NOT NULL DEFAULT true;
