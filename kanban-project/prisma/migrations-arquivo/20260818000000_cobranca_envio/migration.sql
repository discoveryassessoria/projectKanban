-- Aditivo/reversível: registro de ENVIO da cobrança ao cliente.
-- Marca a data de envio + link de pagamento gerado, sem tocar no valor/estado contábil.
ALTER TABLE "Cobranca" ADD COLUMN IF NOT EXISTS "enviadaEm" TIMESTAMP(3);
ALTER TABLE "Cobranca" ADD COLUMN IF NOT EXISTS "linkPagamento" VARCHAR(500);
ALTER TABLE "Cobranca" ADD COLUMN IF NOT EXISTS "enviadaPorId" INTEGER;
