-- ============================================================================
-- TAXA DE PAGAMENTO — Aplicabilidade por RELACIONAMENTO REAL (moeda / país)
-- + compatibilidade da FORMA PADRÃO da Condição de Pagamento.
--
-- 100% ADITIVA e IDEMPOTENTE:
--   • cria 2 tabelas de vínculo da Taxa (moeda / país), com as FKs declaradas
--     no próprio CREATE TABLE IF NOT EXISTS;
--   • BACKFILL a partir das colunas-array legadas ("BRL, EUR" / "BR, PT"), mas
--     SÓ quando o valor legado casa com um registro real do cadastro;
--   • BACKFILL da forma legada `CondicaoPagamento.formaSugeridaId` (hoje "Forma
--     sugerida", agora FORMA PADRÃO) para dentro das Formas permitidas — assim
--     a padrão nunca fica fora da lista permitida;
--   • NÃO altera, NÃO limpa e NÃO remove nenhuma coluna legada — os arrays e o
--     `formaSugeridaId` continuam existindo e alimentando o motor;
--   • valores legados sem correspondência no cadastro permanecem SOMENTE nos
--     arrays (leitura), sem virar vínculo — nada é inventado nem apagado.
--
-- Sem blocos DO $$ ... $$ de propósito: o aplicador do build divide o arquivo
-- por ";" e blocos anônimos quebrariam a divisão.
-- ============================================================================

CREATE TABLE IF NOT EXISTS "TaxaPagamentoMoeda" (
  "id"       SERIAL PRIMARY KEY,
  "taxaId"   INTEGER NOT NULL REFERENCES "TaxaPagamento"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "moedaId"  INTEGER NOT NULL REFERENCES "MoedaCadastro"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "TaxaPagamentoMoeda_taxaId_moedaId_key" ON "TaxaPagamentoMoeda"("taxaId", "moedaId");
CREATE INDEX IF NOT EXISTS "TaxaPagamentoMoeda_taxaId_idx" ON "TaxaPagamentoMoeda"("taxaId");
CREATE INDEX IF NOT EXISTS "TaxaPagamentoMoeda_moedaId_idx" ON "TaxaPagamentoMoeda"("moedaId");

CREATE TABLE IF NOT EXISTS "TaxaPagamentoPais" (
  "id"       SERIAL PRIMARY KEY,
  "taxaId"   INTEGER NOT NULL REFERENCES "TaxaPagamento"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "paisId"   INTEGER NOT NULL REFERENCES "CatalogoPais"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "TaxaPagamentoPais_taxaId_paisId_key" ON "TaxaPagamentoPais"("taxaId", "paisId");
CREATE INDEX IF NOT EXISTS "TaxaPagamentoPais_taxaId_idx" ON "TaxaPagamentoPais"("taxaId");
CREATE INDEX IF NOT EXISTS "TaxaPagamentoPais_paisId_idx" ON "TaxaPagamentoPais"("paisId");

-- Moedas: o array legado guarda o CODE ("BRL", "EUR") -> MoedaCadastro.code
INSERT INTO "TaxaPagamentoMoeda" ("taxaId", "moedaId")
SELECT t."id", m."id"
FROM "TaxaPagamento" t
CROSS JOIN LATERAL unnest(t."moedasAplicaveis") AS v(codigo)
JOIN "MoedaCadastro" m ON upper(m."code") = upper(trim(v.codigo))
ON CONFLICT ("taxaId", "moedaId") DO NOTHING;

-- Países: array legado com texto livre ("BR", "italia", "Itália") -> casa por
-- countryKey, countryLabel ou codePrefix. O que não casar fica só no array.
INSERT INTO "TaxaPagamentoPais" ("taxaId", "paisId")
SELECT t."id", p."id"
FROM "TaxaPagamento" t
CROSS JOIN LATERAL unnest(t."paises") AS v(chave)
JOIN "CatalogoPais" p
  ON lower(p."countryKey") = lower(trim(v.chave))
  OR lower(p."countryLabel") = lower(trim(v.chave))
  OR lower(coalesce(p."codePrefix", '')) = lower(trim(v.chave))
ON CONFLICT ("taxaId", "paisId") DO NOTHING;

-- Forma PADRÃO da Condição (coluna legada `formaSugeridaId`): passa a estar
-- obrigatoriamente entre as Formas permitidas. O dado legado NÃO é apagado.
INSERT INTO "CondicaoPagamentoForma" ("condicaoId", "formaId")
SELECT c."id", c."formaSugeridaId"
FROM "CondicaoPagamento" c
JOIN "FormaPagamentoCadastro" fp ON fp."id" = c."formaSugeridaId"
WHERE c."formaSugeridaId" IS NOT NULL
ON CONFLICT ("condicaoId", "formaId") DO NOTHING;
