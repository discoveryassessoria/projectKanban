-- CP-3 — NecessidadeDocumental. ADITIVA e NÃO-DESTRUTIVA (Regra 20).
-- Sem DROP. FKs de ligação (Documento.necessidadeId, sujeito pessoaId/uniaoId)
-- todas NULLABLE (dual-read + backfill). MatrizDocumental.versao é NOT NULL mas
-- com DEFAULT 1 (seguro p/ linhas existentes; snapshot de versão da regra).
-- CHECK de XOR do sujeito aplicado ao final (tabela nasce vazia).

-- CreateEnum
CREATE TYPE "OrigemNecessidade" AS ENUM ('ARVORE', 'MATRIZ', 'MANUAL', 'MIGRACAO');

-- CreateEnum
CREATE TYPE "ObrigatoriedadeNecessidade" AS ENUM ('OBRIGATORIA', 'OPCIONAL');

-- CreateEnum
CREATE TYPE "StatusNecessidade" AS ENUM ('PENDENTE', 'EM_ATENDIMENTO', 'ATENDIDA', 'NAO_LOCALIZADA', 'DISPENSADA');

-- CreateEnum
CREATE TYPE "TipoEventoNecessidade" AS ENUM ('CRIADA', 'EM_ATENDIMENTO', 'ATENDIDA', 'NAO_LOCALIZADA', 'REABERTA', 'DISPENSADA', 'SUPERSEDIDA', 'RETORNO_GENEALOGIA');

-- AlterTable
ALTER TABLE "Documento" ADD COLUMN     "necessidadeId" INTEGER;

-- AlterTable
ALTER TABLE "MatrizDocumental" ADD COLUMN     "versao" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "NecessidadeDocumental" (
    "id" SERIAL NOT NULL,
    "processoId" INTEGER NOT NULL,
    "itemCatalogoId" INTEGER NOT NULL,
    "pessoaId" INTEGER,
    "uniaoId" INTEGER,
    "varianteKey" VARCHAR(60) NOT NULL DEFAULT 'padrao',
    "ciclo" INTEGER NOT NULL DEFAULT 1,
    "chaveIdempotencia" VARCHAR(200) NOT NULL,
    "origem" "OrigemNecessidade" NOT NULL DEFAULT 'MANUAL',
    "obrigatoriedade" "ObrigatoriedadeNecessidade" NOT NULL DEFAULT 'OBRIGATORIA',
    "status" "StatusNecessidade" NOT NULL DEFAULT 'PENDENTE',
    "matrizRegraId" INTEGER,
    "matrizRegraVersao" INTEGER,
    "matrizSnapshot" JSONB,
    "avaliadaEm" TIMESTAMP(3),
    "motivoAplicabilidade" TEXT,
    "arvoreId" INTEGER,
    "ruleCode" VARCHAR(20),
    "supersedePorId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NecessidadeDocumental_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NecessidadeDocumentalEvento" (
    "id" SERIAL NOT NULL,
    "necessidadeId" INTEGER NOT NULL,
    "tipo" "TipoEventoNecessidade" NOT NULL,
    "descricao" VARCHAR(300),
    "dados" JSONB,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NecessidadeDocumentalEvento_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "NecessidadeDocumental_chaveIdempotencia_key" ON "NecessidadeDocumental"("chaveIdempotencia");

-- CreateIndex
CREATE INDEX "NecessidadeDocumental_processoId_idx" ON "NecessidadeDocumental"("processoId");

-- CreateIndex
CREATE INDEX "NecessidadeDocumental_itemCatalogoId_idx" ON "NecessidadeDocumental"("itemCatalogoId");

-- CreateIndex
CREATE INDEX "NecessidadeDocumental_pessoaId_idx" ON "NecessidadeDocumental"("pessoaId");

-- CreateIndex
CREATE INDEX "NecessidadeDocumental_uniaoId_idx" ON "NecessidadeDocumental"("uniaoId");

-- CreateIndex
CREATE INDEX "NecessidadeDocumental_status_idx" ON "NecessidadeDocumental"("status");

-- CreateIndex
CREATE INDEX "NecessidadeDocumentalEvento_necessidadeId_idx" ON "NecessidadeDocumentalEvento"("necessidadeId");

-- CreateIndex
CREATE INDEX "NecessidadeDocumentalEvento_criadoEm_idx" ON "NecessidadeDocumentalEvento"("criadoEm");

-- CreateIndex
CREATE INDEX "Documento_necessidadeId_idx" ON "Documento"("necessidadeId");

-- AddForeignKey
ALTER TABLE "Documento" ADD CONSTRAINT "Documento_necessidadeId_fkey" FOREIGN KEY ("necessidadeId") REFERENCES "NecessidadeDocumental"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NecessidadeDocumental" ADD CONSTRAINT "NecessidadeDocumental_processoId_fkey" FOREIGN KEY ("processoId") REFERENCES "Processo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NecessidadeDocumental" ADD CONSTRAINT "NecessidadeDocumental_itemCatalogoId_fkey" FOREIGN KEY ("itemCatalogoId") REFERENCES "ItemCatalogo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NecessidadeDocumental" ADD CONSTRAINT "NecessidadeDocumental_pessoaId_fkey" FOREIGN KEY ("pessoaId") REFERENCES "Pessoa"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NecessidadeDocumental" ADD CONSTRAINT "NecessidadeDocumental_uniaoId_fkey" FOREIGN KEY ("uniaoId") REFERENCES "Uniao"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NecessidadeDocumental" ADD CONSTRAINT "NecessidadeDocumental_supersedePorId_fkey" FOREIGN KEY ("supersedePorId") REFERENCES "NecessidadeDocumental"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NecessidadeDocumentalEvento" ADD CONSTRAINT "NecessidadeDocumentalEvento_necessidadeId_fkey" FOREIGN KEY ("necessidadeId") REFERENCES "NecessidadeDocumental"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CP-3 (manual) — XOR do sujeito: exatamente um de pessoaId/uniaoId preenchido.
ALTER TABLE "NecessidadeDocumental" ADD CONSTRAINT "NecessidadeDocumental_sujeito_xor"
  CHECK ((("pessoaId" IS NOT NULL)::int + ("uniaoId" IS NOT NULL)::int) = 1);
