-- PREÇO-FONTE-ÚNICA — migração ADITIVA e NÃO-DESTRUTIVA.
-- Estabelece a Tabela de Preços como única fonte de verdade e move o preço para
-- fora da Configuração Financeira, SEM remover colunas legado (removidas numa
-- migration futura específica, após confirmar que nada depende delas).
--
-- Nada aqui faz DROP/DELETE. Campos legado de valor da Configuração Financeira
-- (ProdutoFinanceiro.valorPadrao/valorCustoPadrao/valorReceitaPadrao) são
-- PRESERVADOS; o backfill `backfill-precos-legado-tabelavalor.ts` copia seus
-- valores para TabelaValor (CUSTO/VENDA) marcando migradoDeCampoLegado=true.
--
-- ATENÇÃO ROLLBACK: valores adicionados a enum PostgreSQL (NaturezaPreco.VENDA)
-- NÃO são removíveis trivialmente. O tipo NaturezaFinanceira é novo.

-- 1) Natureza financeira canônica da Configuração Financeira (o QUE o item pode gerar).
CREATE TYPE "NaturezaFinanceira" AS ENUM ('SOMENTE_CUSTO', 'SOMENTE_RECEITA', 'CUSTO_E_RECEITA');

-- 2) VENDA na Tabela de Preços (RECEITA mantido como legado equivalente).
ALTER TYPE "NaturezaPreco" ADD VALUE IF NOT EXISTS 'VENDA';

-- 3) Configuração Financeira: natureza canônica (nullable na transição; deriva das flags).
ALTER TABLE "ProdutoFinanceiro" ADD COLUMN IF NOT EXISTS "naturezaFin" "NaturezaFinanceira";

-- 4) Tabela de Preços: rastreabilidade da origem migrada.
ALTER TABLE "TabelaValor" ADD COLUMN IF NOT EXISTS "migradoDeCampoLegado" BOOLEAN NOT NULL DEFAULT false;

-- 5) Congelamento (§6) + rastreabilidade (§8) nos lançamentos do processo.
ALTER TABLE "Receita"
  ADD COLUMN IF NOT EXISTS "valorUnitario"       DECIMAL(12,2),
  ADD COLUMN IF NOT EXISTS "quantidade"          DECIMAL(12,2),
  ADD COLUMN IF NOT EXISTS "valorTotalCongelado" DECIMAL(12,2),
  ADD COLUMN IF NOT EXISTS "modoCalculoAplicado" VARCHAR(20),
  ADD COLUMN IF NOT EXISTS "naturezaPreco"       "NaturezaPreco",
  ADD COLUMN IF NOT EXISTS "configFinanceiraId"  INTEGER,
  ADD COLUMN IF NOT EXISTS "regraFinanceiraId"   INTEGER,
  ADD COLUMN IF NOT EXISTS "contextoAplicado"    JSONB,
  ADD COLUMN IF NOT EXISTS "dataReferencia"      TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "chaveIdempotencia"   VARCHAR(200);

ALTER TABLE "Custo"
  ADD COLUMN IF NOT EXISTS "valorUnitario"       DECIMAL(12,2),
  ADD COLUMN IF NOT EXISTS "quantidade"          DECIMAL(12,2),
  ADD COLUMN IF NOT EXISTS "valorTotalCongelado" DECIMAL(12,2),
  ADD COLUMN IF NOT EXISTS "modoCalculoAplicado" VARCHAR(20),
  ADD COLUMN IF NOT EXISTS "naturezaPreco"       "NaturezaPreco",
  ADD COLUMN IF NOT EXISTS "configFinanceiraId"  INTEGER,
  ADD COLUMN IF NOT EXISTS "regraFinanceiraId"   INTEGER,
  ADD COLUMN IF NOT EXISTS "contextoAplicado"    JSONB,
  ADD COLUMN IF NOT EXISTS "dataReferencia"      TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "chaveIdempotencia"   VARCHAR(200);

-- 6) Pendência financeira rastreável (§5/§6): registrada quando NÃO há preço válido
--    ou há conflito de mesma precedência. Anti-duplicação por chave única no banco.
CREATE TABLE IF NOT EXISTS "PendenciaFinanceira" (
  "id"                 SERIAL       NOT NULL,
  "processoId"         INTEGER      NOT NULL,
  "tipoProcessoId"     INTEGER,
  "phaseKey"           VARCHAR(60)  NOT NULL,
  "phaseCycle"         INTEGER      NOT NULL DEFAULT 1,
  "configFinanceiraId" INTEGER,
  "regraFinanceiraId"  INTEGER,
  "natureza"           "NaturezaPreco",
  "motivo"             VARCHAR(40)  NOT NULL,
  "detalhe"            VARCHAR(500) NOT NULL,
  "contexto"           JSONB,
  "chaveIdempotencia"  VARCHAR(220) NOT NULL,
  "resolvida"          BOOLEAN      NOT NULL DEFAULT false,
  "resolvidaEm"        TIMESTAMP(3),
  "criadoEm"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PendenciaFinanceira_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "PendenciaFinanceira_chaveIdempotencia_key"
  ON "PendenciaFinanceira"("chaveIdempotencia");
CREATE INDEX IF NOT EXISTS "PendenciaFinanceira_processoId_idx"         ON "PendenciaFinanceira"("processoId");
CREATE INDEX IF NOT EXISTS "PendenciaFinanceira_phaseKey_idx"           ON "PendenciaFinanceira"("phaseKey");
CREATE INDEX IF NOT EXISTS "PendenciaFinanceira_resolvida_idx"          ON "PendenciaFinanceira"("resolvida");
CREATE INDEX IF NOT EXISTS "PendenciaFinanceira_configFinanceiraId_idx" ON "PendenciaFinanceira"("configFinanceiraId");

-- FK p/ Processo (cascade ao apagar processo), alinhada ao relation do schema.
ALTER TABLE "PendenciaFinanceira"
  ADD CONSTRAINT "PendenciaFinanceira_processoId_fkey"
  FOREIGN KEY ("processoId") REFERENCES "Processo"("id") ON DELETE CASCADE ON UPDATE CASCADE;
