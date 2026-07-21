-- publicCode (CLI) para os cadastros de CLIENTE: Contratante e Requerente.
-- Aditivo, único, nullable (backfill posterior). Sequência CLI compartilhada entre as duas tabelas.
ALTER TABLE "Contratante" ADD COLUMN "publicCode" VARCHAR(20);
ALTER TABLE "Requerente"  ADD COLUMN "publicCode" VARCHAR(20);

CREATE UNIQUE INDEX "Contratante_publicCode_key" ON "Contratante"("publicCode");
CREATE UNIQUE INDEX "Requerente_publicCode_key"  ON "Requerente"("publicCode");
