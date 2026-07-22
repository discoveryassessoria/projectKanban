-- Cobrança: campos de RUNTIME/auditoria calculados pelo ChargeCalculationService.
-- 100% aditivo (colunas nullable, sem default destrutivo). Cobranças existentes
-- seguem válidas: os campos ficam null até o próximo recálculo/confirmação.

ALTER TABLE "Cobranca"
  ADD COLUMN IF NOT EXISTS "politicaTaxas"  VARCHAR(30),
  ADD COLUMN IF NOT EXISTS "valorBase"      DECIMAL(12,2),
  ADD COLUMN IF NOT EXISTS "valorTaxa"      DECIMAL(12,2),
  ADD COLUMN IF NOT EXISTS "valorRepassado" DECIMAL(12,2),
  ADD COLUMN IF NOT EXISTS "valorAbsorvido" DECIMAL(12,2),
  ADD COLUMN IF NOT EXISTS "valorLiquido"   DECIMAL(12,2),
  ADD COLUMN IF NOT EXISTS "moedaOrigem"    VARCHAR(10),
  ADD COLUMN IF NOT EXISTS "cotacao"        DECIMAL(12,6),
  ADD COLUMN IF NOT EXISTS "cotacaoData"    TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "cotacaoFonte"   VARCHAR(40),
  ADD COLUMN IF NOT EXISTS "congeladaEm"    TIMESTAMP(3);
