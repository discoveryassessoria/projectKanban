-- CP-1 — Família + identidade única (Pessoa) com papéis por personId.
-- Migration ADITIVA e NÃO-DESTRUTIVA (Regra 20): nenhum DROP de tabela/coluna.
-- FKs nullable + dual-read; o NOT NULL de Processo.familiaId é passo futuro
-- (após backfill + reconciliação + unresolvedCount = 0).

-- AlterTable
ALTER TABLE "Pessoa" ALTER COLUMN "arvoreId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Arvore" ADD COLUMN     "familiaId" INTEGER;

-- AlterTable
ALTER TABLE "Processo" ADD COLUMN     "familiaId" INTEGER;

-- AlterTable
ALTER TABLE "Contratante" ADD COLUMN     "personId" INTEGER;

-- AlterTable
ALTER TABLE "Requerente" ADD COLUMN     "personId" INTEGER;

-- CreateTable
CREATE TABLE "Familia" (
    "id" SERIAL NOT NULL,
    "nome" VARCHAR(150) NOT NULL,
    "descricao" VARCHAR(300),
    "observacoes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Familia_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Arvore_familiaId_idx" ON "Arvore"("familiaId");

-- CreateIndex
CREATE INDEX "Processo_familiaId_idx" ON "Processo"("familiaId");

-- CreateIndex
CREATE INDEX "Contratante_personId_idx" ON "Contratante"("personId");

-- CreateIndex
CREATE INDEX "Requerente_personId_idx" ON "Requerente"("personId");

-- AddForeignKey
ALTER TABLE "Arvore" ADD CONSTRAINT "Arvore_familiaId_fkey" FOREIGN KEY ("familiaId") REFERENCES "Familia"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Processo" ADD CONSTRAINT "Processo_familiaId_fkey" FOREIGN KEY ("familiaId") REFERENCES "Familia"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contratante" ADD CONSTRAINT "Contratante_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Pessoa"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Requerente" ADD CONSTRAINT "Requerente_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Pessoa"("id") ON DELETE SET NULL ON UPDATE CASCADE;
