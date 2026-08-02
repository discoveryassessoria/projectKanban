-- ============================================================================
-- TAXA DE PAGAMENTO — TABELA DE PARCELAMENTO
--
-- Uma única Taxa passa a representar a tabela comercial inteira da adquirente
-- (1x 2,99% / 2x 3,39% / 3–6x 4,19%…), em vez de exigir um cadastro por
-- quantidade de parcelas.
--
-- 100% ADITIVA e IDEMPOTENTE:
--   • cria a tabela de linhas, com FK e unicidade por faixa;
--   • BACKFILL: taxa legada com "Aplica-se a = FAIXA" e limites preenchidos vira
--     UMA linha equivalente (mesmo percentual/valor fixo) — o comportamento de
--     cálculo continua idêntico;
--   • NÃO remove `aplicaParcela`, `installmentsFrom` nem `installmentsTo`: as
--     colunas e os dados históricos permanecem no banco (o campo saiu apenas da
--     interface);
--   • taxa sem tabela segue usando feePercent/fixedFee do próprio registro.
--
-- Sem blocos DO $$ ... $$ de propósito: o aplicador do build divide por ";".
-- ============================================================================

CREATE TABLE IF NOT EXISTS "TaxaParcelamento" (
  "id"          SERIAL PRIMARY KEY,
  "taxaId"      INTEGER NOT NULL REFERENCES "TaxaPagamento"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "parcelasDe"  INTEGER NOT NULL,
  "parcelasAte" INTEGER NOT NULL,
  "feePercent"  DECIMAL(7,4),
  "fixedFee"    DECIMAL(12,2),
  "antecipacao" BOOLEAN NOT NULL DEFAULT false,
  "ordem"       INTEGER NOT NULL DEFAULT 0,
  "criadoEm"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "TaxaParcelamento_taxaId_parcelasDe_parcelasAte_key" ON "TaxaParcelamento"("taxaId", "parcelasDe", "parcelasAte");
CREATE INDEX IF NOT EXISTS "TaxaParcelamento_taxaId_idx" ON "TaxaParcelamento"("taxaId");

-- Backfill: a faixa legada vira a primeira linha da tabela, sem mudar o cálculo.
INSERT INTO "TaxaParcelamento" ("taxaId", "parcelasDe", "parcelasAte", "feePercent", "fixedFee", "antecipacao", "ordem")
SELECT t."id", t."installmentsFrom", t."installmentsTo", t."feePercent", t."fixedFee",
       COALESCE(t."anticipationEnabled", false), 0
FROM "TaxaPagamento" t
WHERE t."aplicaParcela" = 'FAIXA'
  AND t."installmentsFrom" IS NOT NULL
  AND t."installmentsTo" IS NOT NULL
  AND t."installmentsTo" >= t."installmentsFrom"
ON CONFLICT ("taxaId", "parcelasDe", "parcelasAte") DO NOTHING;
