/*
  Warnings:

  - You are about to drop the column `contratanteId` on the `Processo` table. All the data in the column will be lost.

*/
-- DropForeignKey
ALTER TABLE "public"."Processo" DROP CONSTRAINT "Processo_contratanteId_fkey";

-- DropIndex
DROP INDEX "public"."Processo_contratanteId_idx";

-- AlterTable
ALTER TABLE "public"."Processo" DROP COLUMN "contratanteId";

-- CreateTable
CREATE TABLE "public"."ProcessoContratante" (
    "processoId" INTEGER NOT NULL,
    "contratanteId" INTEGER NOT NULL,

    CONSTRAINT "ProcessoContratante_pkey" PRIMARY KEY ("processoId","contratanteId")
);

-- AddForeignKey
ALTER TABLE "public"."ProcessoContratante" ADD CONSTRAINT "ProcessoContratante_processoId_fkey" FOREIGN KEY ("processoId") REFERENCES "public"."Processo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ProcessoContratante" ADD CONSTRAINT "ProcessoContratante_contratanteId_fkey" FOREIGN KEY ("contratanteId") REFERENCES "public"."Contratante"("id") ON DELETE CASCADE ON UPDATE CASCADE;
