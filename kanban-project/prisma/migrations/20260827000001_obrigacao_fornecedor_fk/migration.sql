-- F1 — Fornecedor: FK real de ObrigacaoEconomica.fornecedorId -> Fornecedor.id.
-- Aditivo/reversível. Antes de criar a constraint, nula referências órfãs (fornecedorId
-- apontando para Fornecedor inexistente) — higiene de dado, não perda de vínculo válido.
UPDATE "ObrigacaoEconomica" o SET "fornecedorId" = NULL
WHERE o."fornecedorId" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "Fornecedor" f WHERE f."id" = o."fornecedorId");

ALTER TABLE "ObrigacaoEconomica"
  ADD CONSTRAINT "ObrigacaoEconomica_fornecedorId_fkey"
  FOREIGN KEY ("fornecedorId") REFERENCES "Fornecedor"("id") ON DELETE SET NULL ON UPDATE CASCADE;
