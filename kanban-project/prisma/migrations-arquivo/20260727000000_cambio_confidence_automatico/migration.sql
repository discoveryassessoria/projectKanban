-- Câmbio automático Confidence — ADITIVO, backward-compatible, reversível.
-- Só adiciona colunas nullable + defaults + índices. NÃO altera/remuda dados existentes.
ALTER TABLE "CotacaoCambio"
  ADD COLUMN IF NOT EXISTS "dataReferencia" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "consultadoEm" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "origem" VARCHAR(30),
  ADD COLUMN IF NOT EXISTS "modalidade" VARCHAR(40),
  ADD COLUMN IF NOT EXISTS "statusIntegracao" VARCHAR(30),
  ADD COLUMN IF NOT EXISTS "payloadHash" VARCHAR(80),
  ADD COLUMN IF NOT EXISTS "urlFonte" VARCHAR(300),
  ADD COLUMN IF NOT EXISTS "vigente" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "semNovaPublicacao" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "substituiId" INTEGER;

CREATE UNIQUE INDEX IF NOT EXISTS "uq_cotacao_confidence"
  ON "CotacaoCambio" ("moedaDe", "moedaPara", "dataReferencia", "modalidade", "origem", "payloadHash");
CREATE INDEX IF NOT EXISTS "CotacaoCambio_moedaDe_moedaPara_vigente_idx"
  ON "CotacaoCambio" ("moedaDe", "moedaPara", "vigente");
