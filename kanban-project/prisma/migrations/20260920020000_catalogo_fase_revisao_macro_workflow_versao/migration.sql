-- CATÁLOGO DE FASES — versionamento e reconciliação (mandato "Catálogo de
-- Fases", 20/09/2026).
--
-- Puramente ADITIVO: nova coluna com DEFAULT em CatalogoFase, duas tabelas
-- novas. Nenhuma coluna existente é removida ou tem tipo alterado. Nenhum
-- dado existente é tocado por este arquivo — o backfill de conteúdo (revisão
-- 1 congelada para cada fase/workflow já existente, correção do catálogo de
-- efeitos, inativação das fases de teste) é feito à parte, por
-- `scripts/backfill-catalogo-fase-revisao.mjs` (dry-run por padrão, com
-- relatório completo do que mudaria — nunca aplicado a produção sem
-- `--aplicar --prod` explícito e autorização separada).
--
-- ROLLBACK (documentado, nunca automático):
--   DROP TABLE IF EXISTS "MacroWorkflowVersao";
--   DROP TABLE IF EXISTS "CatalogoFaseRevisao";
--   ALTER TABLE "CatalogoFase" DROP COLUMN IF EXISTS "status";
--   ALTER TABLE "CatalogoFase" DROP COLUMN IF EXISTS "revisaoAtual";
--   DROP TYPE IF EXISTS "CatalogoFaseStatus";
-- Reversível sem perda: as duas tabelas novas só contêm HISTÓRICO derivado
-- (nada que `CatalogoFase`/`MacroWorkflow`/`FaseMacro` não continuem tendo).
-- A coluna `status` é compatível com `ativo` (mantidas em sincronia pelo
-- código, nunca fonte dupla): removê-la não perde nenhum fato que `ativo`
-- não preserve.

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "CatalogoFaseStatus" AS ENUM ('RASCUNHO', 'PUBLICADA', 'INATIVA');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- AlterTable
ALTER TABLE "CatalogoFase" ADD COLUMN IF NOT EXISTS "revisaoAtual" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "CatalogoFase" ADD COLUMN IF NOT EXISTS "status" "CatalogoFaseStatus" NOT NULL DEFAULT 'PUBLICADA';

-- CreateTable
CREATE TABLE IF NOT EXISTS "CatalogoFaseRevisao" (
    "id" SERIAL NOT NULL,
    "catalogoFaseId" INTEGER NOT NULL,
    "revisao" INTEGER NOT NULL,
    "phaseKey" VARCHAR(60) NOT NULL,
    "label" VARCHAR(120) NOT NULL,
    "descricao" TEXT,
    "escopo" "EscopoExecucao",
    "ordemPadrao" INTEGER NOT NULL,
    "requiredPadrao" BOOLEAN NOT NULL,
    "conditionalPadrao" BOOLEAN NOT NULL,
    "status" "CatalogoFaseStatus" NOT NULL,
    "efeitosPermitidos" JSONB,
    "congeladoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "congeladoPorId" INTEGER,
    "origem" VARCHAR(20) NOT NULL,

    CONSTRAINT "CatalogoFaseRevisao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "MacroWorkflowVersao" (
    "id" SERIAL NOT NULL,
    "macroWorkflowId" INTEGER NOT NULL,
    "versao" INTEGER NOT NULL,
    "tipoProcessoId" INTEGER NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "fases" JSONB NOT NULL,
    "congeladoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "congeladoPorId" INTEGER,
    "origem" VARCHAR(20) NOT NULL,

    CONSTRAINT "MacroWorkflowVersao_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "CatalogoFaseRevisao_catalogoFaseId_idx" ON "CatalogoFaseRevisao"("catalogoFaseId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "CatalogoFaseRevisao_catalogoFaseId_revisao_key" ON "CatalogoFaseRevisao"("catalogoFaseId", "revisao");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "MacroWorkflowVersao_macroWorkflowId_idx" ON "MacroWorkflowVersao"("macroWorkflowId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "MacroWorkflowVersao_macroWorkflowId_versao_key" ON "MacroWorkflowVersao"("macroWorkflowId", "versao");

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "CatalogoFaseRevisao" ADD CONSTRAINT "CatalogoFaseRevisao_catalogoFaseId_fkey" FOREIGN KEY ("catalogoFaseId") REFERENCES "CatalogoFase"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "MacroWorkflowVersao" ADD CONSTRAINT "MacroWorkflowVersao_macroWorkflowId_fkey" FOREIGN KEY ("macroWorkflowId") REFERENCES "MacroWorkflow"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
