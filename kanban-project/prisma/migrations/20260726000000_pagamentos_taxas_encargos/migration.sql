-- ============================================================================
-- PAGAMENTOS — condição aplicada, taxas e encargos no lançamento
--
-- 100% ADITIVA. Nenhuma coluna removida ou renomeada, nenhum default existente
-- alterado. Todas as colunas novas são nullable ou têm default seguro, então
-- os registros atuais permanecem válidos e o motor mantém o comportamento
-- histórico enquanto não houver condição vinculada.
--
-- SQL escrito à mão (política pós-incidente de 21/07: nada de migrate diff).
-- ============================================================================

-- ── Receita: condição aplicada + resultado de taxas (congelados) ────────────
ALTER TABLE "Receita" ADD COLUMN "condicaoPagamentoId" INTEGER;
ALTER TABLE "Receita" ADD COLUMN "condicaoVersao" INTEGER;
ALTER TABLE "Receita" ADD COLUMN "condicaoCodigo" VARCHAR(40);
ALTER TABLE "Receita" ADD COLUMN "valorBruto" DECIMAL(12,2);
ALTER TABLE "Receita" ADD COLUMN "valorTaxas" DECIMAL(12,2);
ALTER TABLE "Receita" ADD COLUMN "valorLiquido" DECIMAL(12,2);
ALTER TABLE "Receita" ADD COLUMN "memoriaCalculo" JSONB;

CREATE INDEX "Receita_condicaoPagamentoId_idx" ON "Receita"("condicaoPagamentoId");
ALTER TABLE "Receita"
  ADD CONSTRAINT "Receita_condicaoPagamentoId_fkey"
  FOREIGN KEY ("condicaoPagamentoId") REFERENCES "CondicaoPagamento"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ── Custo: mesma paridade da Receita ───────────────────────────────────────
ALTER TABLE "Custo" ADD COLUMN "condicaoPagamentoId" INTEGER;
ALTER TABLE "Custo" ADD COLUMN "condicaoVersao" INTEGER;
ALTER TABLE "Custo" ADD COLUMN "condicaoCodigo" VARCHAR(40);
ALTER TABLE "Custo" ADD COLUMN "valorBruto" DECIMAL(12,2);
ALTER TABLE "Custo" ADD COLUMN "valorTaxas" DECIMAL(12,2);
ALTER TABLE "Custo" ADD COLUMN "valorLiquido" DECIMAL(12,2);
ALTER TABLE "Custo" ADD COLUMN "memoriaCalculo" JSONB;

CREATE INDEX "Custo_condicaoPagamentoId_idx" ON "Custo"("condicaoPagamentoId");
ALTER TABLE "Custo"
  ADD CONSTRAINT "Custo_condicaoPagamentoId_fkey"
  FOREIGN KEY ("condicaoPagamentoId") REFERENCES "CondicaoPagamento"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ── ParcelaFinanceira: entrada e rateio de taxa ────────────────────────────
ALTER TABLE "ParcelaFinanceira" ADD COLUMN "entrada" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ParcelaFinanceira" ADD COLUMN "valorTaxa" DECIMAL(12,2);
ALTER TABLE "ParcelaFinanceira" ADD COLUMN "valorLiquido" DECIMAL(12,2);

-- ── TaxaPagamento: incidência, absorção e vigência ─────────────────────────
ALTER TABLE "TaxaPagamento" ADD COLUMN "baseIncidencia" VARCHAR(20) NOT NULL DEFAULT 'TOTAL';
ALTER TABLE "TaxaPagamento" ADD COLUMN "quemAbsorve" VARCHAR(20) NOT NULL DEFAULT 'EMPRESA';
ALTER TABLE "TaxaPagamento" ADD COLUMN "adquirente" VARCHAR(120);
ALTER TABLE "TaxaPagamento" ADD COLUMN "ativo" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "TaxaPagamento" ADD COLUMN "vigenciaInicio" TIMESTAMP(3);
ALTER TABLE "TaxaPagamento" ADD COLUMN "vigenciaFim" TIMESTAMP(3);
