-- Taxa de Pagamento = regra reutilizável de cálculo (não conhece Receita/Cobrança).
-- 100% aditivo: colunas novas com default; installmentsFrom/To e formaPagamentoId
-- (única) preservados p/ compat. Nenhum drop, nenhuma perda de dado.

ALTER TABLE "TaxaPagamento"
  ADD COLUMN IF NOT EXISTS "descricao"              VARCHAR(300),
  ADD COLUMN IF NOT EXISTS "categoria"              VARCHAR(40),
  ADD COLUMN IF NOT EXISTS "formasAplicaveis"       INTEGER[]     NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS "aplicaParcela"          VARCHAR(20),
  ADD COLUMN IF NOT EXISTS "anticipationType"       VARCHAR(20),
  ADD COLUMN IF NOT EXISTS "anticipationFixed"      DECIMAL(12,2),
  ADD COLUMN IF NOT EXISTS "anticipationMinDays"    INTEGER,
  ADD COLUMN IF NOT EXISTS "absorcaoPercentEmpresa" DECIMAL(5,2),
  ADD COLUMN IF NOT EXISTS "prioridade"             INTEGER       NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "paises"                 TEXT[]        NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS "moedasAplicaveis"       TEXT[]        NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS "servicos"               INTEGER[]     NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS "modalidades"            TEXT[]        NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS "tiposProcesso"          TEXT[]        NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS "valorMinimo"            DECIMAL(12,2),
  ADD COLUMN IF NOT EXISTS "valorMaximo"            DECIMAL(12,2),
  ADD COLUMN IF NOT EXISTS "canal"                  VARCHAR(60),
  ADD COLUMN IF NOT EXISTS "gateway"                VARCHAR(40),
  ADD COLUMN IF NOT EXISTS "perfil"                 VARCHAR(60),
  ADD COLUMN IF NOT EXISTS "momentoCambio"          VARCHAR(20);

-- Backfill: forma única legada entra em formasAplicaveis; faixa legada → aplicaParcela.
UPDATE "TaxaPagamento"
   SET "formasAplicaveis" = ARRAY["formaPagamentoId"]
 WHERE "formaPagamentoId" IS NOT NULL AND cardinality("formasAplicaveis") = 0;

UPDATE "TaxaPagamento"
   SET "aplicaParcela" = 'FAIXA'
 WHERE "aplicaParcela" IS NULL AND ("installmentsFrom" IS NOT NULL OR "installmentsTo" IS NOT NULL);

UPDATE "TaxaPagamento"
   SET "aplicaParcela" = 'TODAS'
 WHERE "aplicaParcela" IS NULL;

-- anticipationType derivado do legado anticipationEnabled.
UPDATE "TaxaPagamento"
   SET "anticipationType" = CASE WHEN "anticipationEnabled" THEN 'OPCIONAL' ELSE 'NAO_POSSUI' END
 WHERE "anticipationType" IS NULL;
