-- Aditivo/reversível: coluna nullable para vincular o fornecedor a um lançamento
-- (custo manual). Sem FK forte, no mesmo padrão de faseId/centroCustoId.
ALTER TABLE "ObrigacaoEconomica" ADD COLUMN IF NOT EXISTS "fornecedorId" INTEGER;
