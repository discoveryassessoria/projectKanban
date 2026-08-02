-- CategoriaFinanceira passa a REFERENCIAR cadastros mestres por FK real (MDM).
-- Aditivo/nullable: linhas legadas (texto livre, sem FK) permanecem válidas até o
-- backfill. Exatamente UMA origem pode ser apontada (CHECK). Uma categoria por
-- (mestre × tipo) — anti-duplicação (uniques; NULL é distinto no Postgres).

-- CreateEnum
CREATE TYPE "OrigemCategoria" AS ENUM ('DOCUMENTO', 'SERVICO', 'HONORARIO', 'PROCESSO', 'LEGADO');

-- AlterTable
ALTER TABLE "CategoriaFinanceira" ADD COLUMN     "origem" "OrigemCategoria" NOT NULL DEFAULT 'LEGADO',
ADD COLUMN     "tipoDocumentoId" INTEGER,
ADD COLUMN     "honorarioId" INTEGER,
ADD COLUMN     "tipoProcessoId" INTEGER,
ADD COLUMN     "itemCatalogoId" INTEGER;

-- CreateIndex
CREATE INDEX "CategoriaFinanceira_origem_idx" ON "CategoriaFinanceira"("origem");

-- CreateIndex
CREATE INDEX "CategoriaFinanceira_tipoDocumentoId_idx" ON "CategoriaFinanceira"("tipoDocumentoId");

-- CreateIndex
CREATE INDEX "CategoriaFinanceira_honorarioId_idx" ON "CategoriaFinanceira"("honorarioId");

-- CreateIndex
CREATE INDEX "CategoriaFinanceira_tipoProcessoId_idx" ON "CategoriaFinanceira"("tipoProcessoId");

-- CreateIndex
CREATE INDEX "CategoriaFinanceira_itemCatalogoId_idx" ON "CategoriaFinanceira"("itemCatalogoId");

-- CreateIndex
CREATE UNIQUE INDEX "CategoriaFinanceira_tipoDocumentoId_tipo_key" ON "CategoriaFinanceira"("tipoDocumentoId", "tipo");

-- CreateIndex
CREATE UNIQUE INDEX "CategoriaFinanceira_honorarioId_tipo_key" ON "CategoriaFinanceira"("honorarioId", "tipo");

-- CreateIndex
CREATE UNIQUE INDEX "CategoriaFinanceira_tipoProcessoId_tipo_key" ON "CategoriaFinanceira"("tipoProcessoId", "tipo");

-- CreateIndex
CREATE UNIQUE INDEX "CategoriaFinanceira_itemCatalogoId_tipo_key" ON "CategoriaFinanceira"("itemCatalogoId", "tipo");

-- AddForeignKey
ALTER TABLE "CategoriaFinanceira" ADD CONSTRAINT "CategoriaFinanceira_tipoDocumentoId_fkey" FOREIGN KEY ("tipoDocumentoId") REFERENCES "TipoDocumentoCadastro"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CategoriaFinanceira" ADD CONSTRAINT "CategoriaFinanceira_honorarioId_fkey" FOREIGN KEY ("honorarioId") REFERENCES "Honorario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CategoriaFinanceira" ADD CONSTRAINT "CategoriaFinanceira_tipoProcessoId_fkey" FOREIGN KEY ("tipoProcessoId") REFERENCES "TipoProcessoNacionalidade"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CategoriaFinanceira" ADD CONSTRAINT "CategoriaFinanceira_itemCatalogoId_fkey" FOREIGN KEY ("itemCatalogoId") REFERENCES "ItemCatalogo"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Constraint de negócio (fora do modelo Prisma): no máximo UMA origem por categoria.
ALTER TABLE "CategoriaFinanceira" ADD CONSTRAINT "CategoriaFinanceira_origem_unica_check" CHECK (
  ((CASE WHEN "tipoDocumentoId" IS NOT NULL THEN 1 ELSE 0 END)
 + (CASE WHEN "honorarioId"     IS NOT NULL THEN 1 ELSE 0 END)
 + (CASE WHEN "tipoProcessoId"  IS NOT NULL THEN 1 ELSE 0 END)
 + (CASE WHEN "itemCatalogoId"  IS NOT NULL THEN 1 ELSE 0 END)) <= 1
);
