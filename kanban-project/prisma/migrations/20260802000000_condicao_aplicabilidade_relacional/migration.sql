-- ============================================================================
-- CONDIÇÃO DE PAGAMENTO — Aplicabilidade por RELACIONAMENTO REAL
--
-- 100% ADITIVA e IDEMPOTENTE:
--   • cria 4 tabelas de vínculo (moeda / país / modalidade / serviço), com as
--     FKs declaradas no próprio CREATE TABLE IF NOT EXISTS (idempotente);
--   • faz o BACKFILL a partir das colunas-array legadas, mas SÓ quando o valor
--     legado casa com um registro real do cadastro (conversão segura);
--   • NÃO altera, NÃO limpa e NÃO remove nenhuma coluna legada — os arrays
--     continuam existindo e alimentando o motor de cálculo (condicaoAplicavel);
--   • valores legados sem correspondência no cadastro permanecem SOMENTE nos
--     arrays (leitura), sem virar vínculo — nada é inventado nem apagado.
--
-- Sem blocos DO $$ ... $$ de propósito: o aplicador do build divide o arquivo
-- por ";" e blocos anônimos quebrariam a divisão.
-- ============================================================================

CREATE TABLE IF NOT EXISTS "CondicaoPagamentoMoeda" (
  "id"         SERIAL PRIMARY KEY,
  "condicaoId" INTEGER NOT NULL REFERENCES "CondicaoPagamento"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "moedaId"    INTEGER NOT NULL REFERENCES "MoedaCadastro"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "criadoEm"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "CondicaoPagamentoMoeda_condicaoId_moedaId_key" ON "CondicaoPagamentoMoeda"("condicaoId", "moedaId");
CREATE INDEX IF NOT EXISTS "CondicaoPagamentoMoeda_condicaoId_idx" ON "CondicaoPagamentoMoeda"("condicaoId");
CREATE INDEX IF NOT EXISTS "CondicaoPagamentoMoeda_moedaId_idx" ON "CondicaoPagamentoMoeda"("moedaId");

CREATE TABLE IF NOT EXISTS "CondicaoPagamentoPais" (
  "id"         SERIAL PRIMARY KEY,
  "condicaoId" INTEGER NOT NULL REFERENCES "CondicaoPagamento"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "paisId"     INTEGER NOT NULL REFERENCES "CatalogoPais"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "criadoEm"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "CondicaoPagamentoPais_condicaoId_paisId_key" ON "CondicaoPagamentoPais"("condicaoId", "paisId");
CREATE INDEX IF NOT EXISTS "CondicaoPagamentoPais_condicaoId_idx" ON "CondicaoPagamentoPais"("condicaoId");
CREATE INDEX IF NOT EXISTS "CondicaoPagamentoPais_paisId_idx" ON "CondicaoPagamentoPais"("paisId");

CREATE TABLE IF NOT EXISTS "CondicaoPagamentoModalidade" (
  "id"           SERIAL PRIMARY KEY,
  "condicaoId"   INTEGER NOT NULL REFERENCES "CondicaoPagamento"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "modalidadeId" INTEGER NOT NULL REFERENCES "ModalidadePais"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "criadoEm"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "CondicaoPagamentoModalidade_condicaoId_modalidadeId_key" ON "CondicaoPagamentoModalidade"("condicaoId", "modalidadeId");
CREATE INDEX IF NOT EXISTS "CondicaoPagamentoModalidade_condicaoId_idx" ON "CondicaoPagamentoModalidade"("condicaoId");
CREATE INDEX IF NOT EXISTS "CondicaoPagamentoModalidade_modalidadeId_idx" ON "CondicaoPagamentoModalidade"("modalidadeId");

CREATE TABLE IF NOT EXISTS "CondicaoPagamentoServico" (
  "id"         SERIAL PRIMARY KEY,
  "condicaoId" INTEGER NOT NULL REFERENCES "CondicaoPagamento"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "servicoId"  INTEGER NOT NULL REFERENCES "ServicoProduto"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "criadoEm"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "CondicaoPagamentoServico_condicaoId_servicoId_key" ON "CondicaoPagamentoServico"("condicaoId", "servicoId");
CREATE INDEX IF NOT EXISTS "CondicaoPagamentoServico_condicaoId_idx" ON "CondicaoPagamentoServico"("condicaoId");
CREATE INDEX IF NOT EXISTS "CondicaoPagamentoServico_servicoId_idx" ON "CondicaoPagamentoServico"("servicoId");

-- Moedas: o array legado guarda o CODE ("BRL", "EUR") -> MoedaCadastro.code
INSERT INTO "CondicaoPagamentoMoeda" ("condicaoId", "moedaId")
SELECT c."id", m."id"
FROM "CondicaoPagamento" c
CROSS JOIN LATERAL unnest(c."moedasPermitidas") AS v(codigo)
JOIN "MoedaCadastro" m ON upper(m."code") = upper(trim(v.codigo))
ON CONFLICT ("condicaoId", "moedaId") DO NOTHING;

-- Países: array legado com texto livre -> casa por countryKey OU countryLabel
INSERT INTO "CondicaoPagamentoPais" ("condicaoId", "paisId")
SELECT c."id", p."id"
FROM "CondicaoPagamento" c
CROSS JOIN LATERAL unnest(c."paises") AS v(chave)
JOIN "CatalogoPais" p ON lower(p."countryKey") = lower(trim(v.chave)) OR lower(p."countryLabel") = lower(trim(v.chave))
ON CONFLICT ("condicaoId", "paisId") DO NOTHING;

-- Modalidades: array legado com texto livre -> casa por modalityKey OU modalityLabel
INSERT INTO "CondicaoPagamentoModalidade" ("condicaoId", "modalidadeId")
SELECT c."id", md."id"
FROM "CondicaoPagamento" c
CROSS JOIN LATERAL unnest(c."modalidades") AS v(chave)
JOIN "ModalidadePais" md ON lower(md."modalityKey") = lower(trim(v.chave)) OR lower(md."modalityLabel") = lower(trim(v.chave))
ON CONFLICT ("condicaoId", "modalidadeId") DO NOTHING;

-- Serviços: o array legado já guarda o ID de ServicoProduto -> vínculo direto
INSERT INTO "CondicaoPagamentoServico" ("condicaoId", "servicoId")
SELECT c."id", s."id"
FROM "CondicaoPagamento" c
CROSS JOIN LATERAL unnest(c."servicos") AS v(sid)
JOIN "ServicoProduto" s ON s."id" = v.sid
ON CONFLICT ("condicaoId", "servicoId") DO NOTHING;
