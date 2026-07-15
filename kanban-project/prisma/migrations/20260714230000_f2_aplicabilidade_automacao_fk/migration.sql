-- AlterTable
ALTER TABLE "PhaseEconomicRule" ADD COLUMN     "custoConfigId" INTEGER,
ADD COLUMN     "receitaConfigId" INTEGER,
ADD COLUMN     "tipoDocumentoId" INTEGER;

-- AlterTable
ALTER TABLE "PhaseTriggerRule" ADD COLUMN     "configItemId" INTEGER;

-- AlterTable
ALTER TABLE "ProdutoFinanceiro" ADD COLUMN     "fornecedorPadraoId" INTEGER;

-- CreateIndex
CREATE INDEX "PhaseEconomicRule_tipoDocumentoId_idx" ON "PhaseEconomicRule"("tipoDocumentoId");

-- CreateIndex
CREATE INDEX "PhaseEconomicRule_custoConfigId_idx" ON "PhaseEconomicRule"("custoConfigId");

-- CreateIndex
CREATE INDEX "PhaseEconomicRule_receitaConfigId_idx" ON "PhaseEconomicRule"("receitaConfigId");

-- CreateIndex
CREATE INDEX "PhaseTriggerRule_configItemId_idx" ON "PhaseTriggerRule"("configItemId");

-- CreateIndex
CREATE INDEX "ProdutoFinanceiro_fornecedorPadraoId_idx" ON "ProdutoFinanceiro"("fornecedorPadraoId");

-- AddForeignKey
ALTER TABLE "ProdutoFinanceiro" ADD CONSTRAINT "ProdutoFinanceiro_fornecedorPadraoId_fkey" FOREIGN KEY ("fornecedorPadraoId") REFERENCES "Fornecedor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhaseTriggerRule" ADD CONSTRAINT "PhaseTriggerRule_configItemId_fkey" FOREIGN KEY ("configItemId") REFERENCES "ProdutoFinanceiro"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhaseEconomicRule" ADD CONSTRAINT "PhaseEconomicRule_tipoDocumentoId_fkey" FOREIGN KEY ("tipoDocumentoId") REFERENCES "TipoDocumentoCadastro"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhaseEconomicRule" ADD CONSTRAINT "PhaseEconomicRule_custoConfigId_fkey" FOREIGN KEY ("custoConfigId") REFERENCES "ProdutoFinanceiro"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhaseEconomicRule" ADD CONSTRAINT "PhaseEconomicRule_receitaConfigId_fkey" FOREIGN KEY ("receitaConfigId") REFERENCES "ProdutoFinanceiro"("id") ON DELETE SET NULL ON UPDATE CASCADE;

