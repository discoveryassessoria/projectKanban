-- CreateEnum
CREATE TYPE "PapelFinanceiro" AS ENUM ('CUSTO', 'RECEITA', 'REPASSE', 'REEMBOLSO', 'DESPESA_INTERNA', 'TAXA', 'HONORARIO');

-- AlterTable
ALTER TABLE "ProdutoFinanceiro" ADD COLUMN     "honorarioId" INTEGER,
ADD COLUMN     "papelFinanceiro" "PapelFinanceiro",
ADD COLUMN     "tipoDocumentoId" INTEGER,
ADD COLUMN     "tipoProcessoId" INTEGER;

-- CreateIndex
CREATE INDEX "ProdutoFinanceiro_tipoDocumentoId_idx" ON "ProdutoFinanceiro"("tipoDocumentoId");

-- CreateIndex
CREATE INDEX "ProdutoFinanceiro_honorarioId_idx" ON "ProdutoFinanceiro"("honorarioId");

-- CreateIndex
CREATE INDEX "ProdutoFinanceiro_tipoProcessoId_idx" ON "ProdutoFinanceiro"("tipoProcessoId");

-- CreateIndex
CREATE INDEX "ProdutoFinanceiro_papelFinanceiro_idx" ON "ProdutoFinanceiro"("papelFinanceiro");

-- AddForeignKey
ALTER TABLE "ProdutoFinanceiro" ADD CONSTRAINT "ProdutoFinanceiro_tipoDocumentoId_fkey" FOREIGN KEY ("tipoDocumentoId") REFERENCES "TipoDocumentoCadastro"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProdutoFinanceiro" ADD CONSTRAINT "ProdutoFinanceiro_honorarioId_fkey" FOREIGN KEY ("honorarioId") REFERENCES "Honorario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProdutoFinanceiro" ADD CONSTRAINT "ProdutoFinanceiro_tipoProcessoId_fkey" FOREIGN KEY ("tipoProcessoId") REFERENCES "TipoProcessoNacionalidade"("id") ON DELETE SET NULL ON UPDATE CASCADE;

