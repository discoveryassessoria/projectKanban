-- AlterTable
ALTER TABLE "TabelaValor" ADD COLUMN     "configuracaoFinanceiraItemId" INTEGER,
ADD COLUMN     "legadoPendente" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "modalidadeId" INTEGER,
ADD COLUMN     "prioridade" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "quantidadeMaxima" DECIMAL(12,2),
ADD COLUMN     "quantidadeMinima" DECIMAL(12,2),
ADD COLUMN     "unidade" VARCHAR(20);

-- CreateIndex
CREATE INDEX "TabelaValor_configuracaoFinanceiraItemId_idx" ON "TabelaValor"("configuracaoFinanceiraItemId");

-- CreateIndex
CREATE INDEX "TabelaValor_modalidadeId_idx" ON "TabelaValor"("modalidadeId");

-- AddForeignKey
ALTER TABLE "TabelaValor" ADD CONSTRAINT "TabelaValor_configuracaoFinanceiraItemId_fkey" FOREIGN KEY ("configuracaoFinanceiraItemId") REFERENCES "ProdutoFinanceiro"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TabelaValor" ADD CONSTRAINT "TabelaValor_modalidadeId_fkey" FOREIGN KEY ("modalidadeId") REFERENCES "ModalidadePais"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- F4 — impede DOIS preços ATIVOS no mesmo contexto (config+processo+modalidade+fornecedor+prioridade+vigência)
CREATE UNIQUE INDEX "TabelaValor_config_contexto_ativo_key"
ON "TabelaValor" ("configuracaoFinanceiraItemId", COALESCE("processoTipoId",''), COALESCE("modalidadeId",-1), COALESCE("fornecedorId",-1), "prioridade", COALESCE("vigenciaInicio",''), COALESCE("vigenciaFim",''))
WHERE "arquivado" = false AND "configuracaoFinanceiraItemId" IS NOT NULL;
