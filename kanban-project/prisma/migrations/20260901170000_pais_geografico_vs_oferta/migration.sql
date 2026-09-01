-- ============================================================================
-- PAÍS GEOGRÁFICO ≠ NACIONALIDADE OFERTADA
-- ----------------------------------------------------------------------------
-- O erro conceitual que esta migration desfaz: o sistema tratava "país existe no
-- cadastro" como "o Discovery vende cidadania desse país". A prova estava em
-- /api/kanban-config, que devolvia TODO `CatalogoPais` ativo como aba de
-- nacionalidade — cadastrar Paraguai para registrar o país de um consulado faria
-- surgir uma cidadania paraguaia que ninguém vende.
--
-- A separação NÃO cria cadastro novo. A configuração de oferta já existia e é o
-- Tipo de Processo por nacionalidade: sem um tipo ativo, não há o que abrir
-- naquele país. O que faltava era a IDENTIDADE do vínculo — o tipo apontava para
-- o país por `countryKey` em texto, e por isso ninguém conseguia perguntar ao
-- banco "quais países são ofertados?".
--
-- `countryKey`, `countryLabel`, `nationalityKey` e `nationalityLabel` continuam
-- por enquanto: têm consumidores. Deixam de ser identidade agora; saem quando o
-- último leitor sair.
-- ============================================================================

ALTER TABLE "TipoProcessoNacionalidade" ADD COLUMN IF NOT EXISTS "paisId" INTEGER;

-- Backfill determinístico pela chave — os 4 tipos existentes têm countryKey
-- exatamente igual ao countryKey do cadastro.
UPDATE "TipoProcessoNacionalidade" t SET "paisId" = c.id
  FROM "CatalogoPais" c
 WHERE t."paisId" IS NULL AND lower(t."countryKey") = lower(c."countryKey");

CREATE INDEX IF NOT EXISTS "TipoProcessoNacionalidade_paisId_idx" ON "TipoProcessoNacionalidade"("paisId");

DO $$ BEGIN
  ALTER TABLE "TipoProcessoNacionalidade" ADD CONSTRAINT "TipoProcessoNacionalidade_paisId_fkey"
    FOREIGN KEY ("paisId") REFERENCES "CatalogoPais"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
