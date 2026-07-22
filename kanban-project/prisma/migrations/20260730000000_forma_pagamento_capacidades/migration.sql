-- Forma de Pagamento = capacidades técnicas do MEIO (regra reutilizável).
-- 100% aditivo: colunas novas com default; `moeda` (única) preservada p/ backfill.
-- Nenhum drop, nenhuma perda de dado.

ALTER TABLE "FormaPagamentoCadastro"
  ADD COLUMN IF NOT EXISTS "descricao"                VARCHAR(300),
  ADD COLUMN IF NOT EXISTS "categoria"                VARCHAR(40),
  ADD COLUMN IF NOT EXISTS "moedasAceitas"            TEXT[]      NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS "permiteCancelamento"      BOOLEAN     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "permiteEstorno"           BOOLEAN     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "permiteReembolso"         BOOLEAN     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "permiteInternacional"     BOOLEAN     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "liquidacaoAutomatica"     BOOLEAN     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "conciliacaoAutomatica"    BOOLEAN     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "permiteComprovante"       BOOLEAN     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "emissaoAutomatica"        BOOLEAN     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "permiteCobrancaManual"    BOOLEAN     NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "tipoIntegracao"           VARCHAR(20),
  ADD COLUMN IF NOT EXISTS "provedorIntegracao"       VARCHAR(120),
  ADD COLUMN IF NOT EXISTS "integracaoAtiva"          BOOLEAN     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "carteirasCompativeis"     INTEGER[]   NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS "contasCompativeis"        INTEGER[]   NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS "prazoLiquidacao"          VARCHAR(10),
  ADD COLUMN IF NOT EXISTS "diasLiquidacao"           INTEGER,
  ADD COLUMN IF NOT EXISTS "diasCorridos"             BOOLEAN     NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "permiteAntecipacao"       BOOLEAN     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "utilizaTaxas"             BOOLEAN     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "permiteTaxaAntecipacao"   BOOLEAN     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "permiteTaxaParcelamento"  BOOLEAN     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "permiteTaxaInternacional" BOOLEAN     NOT NULL DEFAULT false;

-- Backfill: quem tinha moeda única passa a tê-la também em moedasAceitas.
UPDATE "FormaPagamentoCadastro"
   SET "moedasAceitas" = ARRAY["moeda"]
 WHERE "moeda" IS NOT NULL AND "moeda" <> '' AND cardinality("moedasAceitas") = 0;
