-- Aditivo/reversível/idempotente: arquivamento da Receita (ação "Mais Ações").
-- Marca a data de arquivamento SEM tocar em saldos, cobranças, pagamentos ou ledger.
ALTER TABLE "Receita" ADD COLUMN IF NOT EXISTS "arquivadaEm" TIMESTAMP(3);
