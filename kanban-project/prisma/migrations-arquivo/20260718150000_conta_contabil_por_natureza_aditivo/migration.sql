-- CONTA CONTÁBIL POR NATUREZA (aditivo, não destrutivo)
-- Desdobra a "Conta Contábil" única (planoContaId) em duas contas por natureza:
--   planoContaReceitaId (usada ao gerar RECEITA) e planoContaCustoId (ao gerar CUSTO).
-- O campo legado planoContaId é PRESERVADO (sem DROP) como fallback histórico.

-- 1) Colunas aditivas (nullable) + FKs para PlanoConta (SET NULL: nunca órfã, nunca cascade delete)
ALTER TABLE "ProdutoFinanceiro" ADD COLUMN "planoContaReceitaId" INTEGER;
ALTER TABLE "ProdutoFinanceiro" ADD COLUMN "planoContaCustoId" INTEGER;

ALTER TABLE "ProdutoFinanceiro"
  ADD CONSTRAINT "ProdutoFinanceiro_planoContaReceitaId_fkey"
  FOREIGN KEY ("planoContaReceitaId") REFERENCES "PlanoConta"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ProdutoFinanceiro"
  ADD CONSTRAINT "ProdutoFinanceiro_planoContaCustoId_fkey"
  FOREIGN KEY ("planoContaCustoId") REFERENCES "PlanoConta"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "ProdutoFinanceiro_planoContaReceitaId_idx" ON "ProdutoFinanceiro"("planoContaReceitaId");
CREATE INDEX "ProdutoFinanceiro_planoContaCustoId_idx" ON "ProdutoFinanceiro"("planoContaCustoId");

-- 2) Migração aditiva do valor legado → ambas as contas, APENAS quando não há
--    informação mais específica (a coluna nova ainda está NULL). Preserva todos os dados.
UPDATE "ProdutoFinanceiro"
  SET "planoContaReceitaId" = "planoContaId"
  WHERE "planoContaId" IS NOT NULL AND "planoContaReceitaId" IS NULL;

UPDATE "ProdutoFinanceiro"
  SET "planoContaCustoId" = "planoContaId"
  WHERE "planoContaId" IS NOT NULL AND "planoContaCustoId" IS NULL;
