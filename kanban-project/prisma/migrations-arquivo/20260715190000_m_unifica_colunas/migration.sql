-- ============================================================================
-- M-UNIFICA (1/3) — colunas de VALOR da Configuração Financeira unificada.
-- Aditivo/seguro: custo e receita passam a ser VALORES de UMA config por mestre,
-- não mais registros independentes. O papel financeiro sai da config (fica só em
-- TabelaValor.natureza). Estas colunas são preenchidas no passo 2/3 (merge).
-- ============================================================================
ALTER TABLE "ProdutoFinanceiro"
  ADD COLUMN "possuiCusto"        BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "possuiReceita"      BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "valorCustoPadrao"   DECIMAL(12,2),
  ADD COLUMN "valorReceitaPadrao" DECIMAL(12,2);
