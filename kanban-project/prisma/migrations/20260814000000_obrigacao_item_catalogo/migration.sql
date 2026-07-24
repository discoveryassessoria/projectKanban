-- Aditivo/reversível: vínculo estrutural do lançamento manual ao item do
-- Cadastro Mestre (ItemCatalogo). Nullable, sem FK forte (padrão faseId/fornecedorId).
ALTER TABLE "ObrigacaoEconomica" ADD COLUMN IF NOT EXISTS "itemCatalogoId" INTEGER;
CREATE INDEX IF NOT EXISTS "ObrigacaoEconomica_itemCatalogoId_idx" ON "ObrigacaoEconomica"("itemCatalogoId");
