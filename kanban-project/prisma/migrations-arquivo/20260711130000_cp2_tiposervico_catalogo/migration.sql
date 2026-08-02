-- CP-2 — Catálogo Mestre: referência aditiva de TipoServico -> ItemCatalogo.
-- ADITIVA e NÃO-DESTRUTIVA (Regra 20): sem DROP, sem NOT NULL prematuro.
-- FK nullable + dual-read (preferir vínculo canônico, fallback legado).
-- (Documento Mestre e Fornecedor não exigem mudança de schema: as FKs para
--  ItemCatalogo/Pessoa já existem; a unificação é de service/rotas/backfill.)

-- AlterTable
ALTER TABLE "TipoServico" ADD COLUMN     "itemCatalogoId" INTEGER;

-- CreateIndex
CREATE INDEX "TipoServico_itemCatalogoId_idx" ON "TipoServico"("itemCatalogoId");

-- AddForeignKey
ALTER TABLE "TipoServico" ADD CONSTRAINT "TipoServico_itemCatalogoId_fkey" FOREIGN KEY ("itemCatalogoId") REFERENCES "ItemCatalogo"("id") ON DELETE SET NULL ON UPDATE CASCADE;
