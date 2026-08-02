-- Adquirente / Gateway e Bandeira de cartão como ENTIDADES definitivas.
-- 100% aditivo/idempotente: novas tabelas + colunas de vínculo/snapshot nullable.
-- O campo string TaxaPagamento.adquirente é PRESERVADO (compat). Nenhum drop.

CREATE TABLE IF NOT EXISTS "Adquirente" (
  "id"                   SERIAL PRIMARY KEY,
  "code"                 VARCHAR(20),
  "slug"                 VARCHAR(40) NOT NULL,
  "nome"                 VARCHAR(120) NOT NULL,
  "ativo"                BOOLEAN NOT NULL DEFAULT true,
  "formasSuportadas"     INTEGER[] NOT NULL DEFAULT '{}',
  "vigenciaInicio"       TIMESTAMP(3),
  "vigenciaFim"          TIMESTAMP(3),
  "identificadorExterno" VARCHAR(120),
  "metadados"            JSONB,
  "criadoEm"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "atualizadoEm"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "Adquirente_slug_key" ON "Adquirente"("slug");
CREATE UNIQUE INDEX IF NOT EXISTS "Adquirente_code_key" ON "Adquirente"("code");
CREATE INDEX IF NOT EXISTS "Adquirente_ativo_idx" ON "Adquirente"("ativo");

CREATE TABLE IF NOT EXISTS "Bandeira" (
  "id"                     SERIAL PRIMARY KEY,
  "code"                   VARCHAR(20),
  "slug"                   VARCHAR(40) NOT NULL,
  "nome"                   VARCHAR(60) NOT NULL,
  "ativo"                  BOOLEAN NOT NULL DEFAULT true,
  "adquirentesCompativeis" INTEGER[] NOT NULL DEFAULT '{}',
  "criadoEm"               TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "atualizadoEm"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "Bandeira_slug_key" ON "Bandeira"("slug");
CREATE UNIQUE INDEX IF NOT EXISTS "Bandeira_code_key" ON "Bandeira"("code");
CREATE INDEX IF NOT EXISTS "Bandeira_ativo_idx" ON "Bandeira"("ativo");

ALTER TABLE "TaxaPagamento"
  ADD COLUMN IF NOT EXISTS "adquirenteId" INTEGER,
  ADD COLUMN IF NOT EXISTS "bandeiraId"   INTEGER;

ALTER TABLE "Cobranca"
  ADD COLUMN IF NOT EXISTS "adquirenteId" INTEGER,
  ADD COLUMN IF NOT EXISTS "bandeiraId"   INTEGER;
