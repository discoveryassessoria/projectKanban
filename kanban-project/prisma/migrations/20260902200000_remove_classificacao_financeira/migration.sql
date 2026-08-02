-- FIM DA SEÇÃO "CLASSIFICAÇÃO" DO FINANCEIRO (02/08/2026).
--
-- Categorias Financeiras, Plano de Contas e Centros de Custo deixam de existir
-- como cadastro. O comportamento financeiro passa a viver EXCLUSIVAMENTE na
-- Configuração Financeira do próprio cadastro mestre (ProdutoFinanceiro), sem
-- classificação intermediária; preço continua sendo assunto da Tabela de Valores.
--
-- Nenhum dado é perdido: em produção as três tabelas estavam VAZIAS e nenhuma
-- linha usava as colunas removidas (ProdutoFinanceiro 4 configs / 0 com
-- categoria e 0 com conta; Transacao 0; ContaPagar 0; ObrigacaoEconomica 19 / 0
-- com centro de custo e 0 com conta contábil).
--
-- O Ledger do motor V3 NÃO depende destas tabelas: ele grava a conta contábil
-- como texto, a partir do plano fixo em lib/financeiro/ledger/plano-contas.ts.
-- Idempotente.

-- ── 1) Configuração Financeira: some a classificação, entra a comissão ───────
ALTER TABLE "ProdutoFinanceiro" DROP CONSTRAINT IF EXISTS "ProdutoFinanceiro_categoriaId_fkey";
ALTER TABLE "ProdutoFinanceiro" DROP CONSTRAINT IF EXISTS "ProdutoFinanceiro_planoContaId_fkey";
ALTER TABLE "ProdutoFinanceiro" DROP CONSTRAINT IF EXISTS "ProdutoFinanceiro_planoContaReceitaId_fkey";
ALTER TABLE "ProdutoFinanceiro" DROP CONSTRAINT IF EXISTS "ProdutoFinanceiro_planoContaCustoId_fkey";
DROP INDEX IF EXISTS "ProdutoFinanceiro_categoriaId_idx";
DROP INDEX IF EXISTS "ProdutoFinanceiro_planoContaId_idx";
DROP INDEX IF EXISTS "ProdutoFinanceiro_planoContaReceitaId_idx";
DROP INDEX IF EXISTS "ProdutoFinanceiro_planoContaCustoId_idx";
ALTER TABLE "ProdutoFinanceiro" DROP COLUMN IF EXISTS "categoriaId";
ALTER TABLE "ProdutoFinanceiro" DROP COLUMN IF EXISTS "planoContaId";
ALTER TABLE "ProdutoFinanceiro" DROP COLUMN IF EXISTS "planoContaReceitaId";
ALTER TABLE "ProdutoFinanceiro" DROP COLUMN IF EXISTS "planoContaCustoId";

ALTER TABLE "ProdutoFinanceiro" ADD COLUMN IF NOT EXISTS "regraComissaoId" INTEGER;
CREATE INDEX IF NOT EXISTS "ProdutoFinanceiro_regraComissaoId_idx" ON "ProdutoFinanceiro"("regraComissaoId");
ALTER TABLE "ProdutoFinanceiro" DROP CONSTRAINT IF EXISTS "ProdutoFinanceiro_regraComissaoId_fkey";
ALTER TABLE "ProdutoFinanceiro" ADD CONSTRAINT "ProdutoFinanceiro_regraComissaoId_fkey" FOREIGN KEY ("regraComissaoId") REFERENCES "RegraComissao"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ── 2) lançamentos legados deixam de apontar para categoria ─────────────────
ALTER TABLE "Transacao" DROP CONSTRAINT IF EXISTS "Transacao_categoriaId_fkey";
DROP INDEX IF EXISTS "Transacao_categoriaId_idx";
ALTER TABLE "Transacao" DROP COLUMN IF EXISTS "categoriaId";

ALTER TABLE "ContaPagar" DROP CONSTRAINT IF EXISTS "ContaPagar_categoriaId_fkey";
DROP INDEX IF EXISTS "ContaPagar_categoriaId_idx";
ALTER TABLE "ContaPagar" DROP COLUMN IF EXISTS "categoriaId";

-- ── 3) obrigação econômica: dimensões que só existiam por causa dos cadastros ─
DROP INDEX IF EXISTS "ObrigacaoEconomica_centroCustoId_idx";
ALTER TABLE "ObrigacaoEconomica" DROP COLUMN IF EXISTS "centroCustoId";
ALTER TABLE "ObrigacaoEconomica" DROP COLUMN IF EXISTS "contaContabilId";

-- ── 4) os cadastros em si ───────────────────────────────────────────────────
DROP TABLE IF EXISTS "CategoriaFinanceira";
DROP TABLE IF EXISTS "PlanoConta";
DROP TABLE IF EXISTS "CentroCusto";
DROP TYPE IF EXISTS "OrigemCategoria";
