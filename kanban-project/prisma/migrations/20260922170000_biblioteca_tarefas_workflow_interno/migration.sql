-- Biblioteca de Tarefas dos Workflows Internos (mandato 22/09/2026).
-- Três entidades novas: Modelo (casca de PhaseInternalWorkflow marcada
-- origemBiblioteca=true), Vínculo (decisão fase+tipo+modalidade) e sua
-- versão congelada. Nenhuma coluna/índice/constraint pré-existente é
-- alterada; CatalogoFase permanece intocado (módulo congelado doc 30).

-- CreateEnum
CREATE TYPE "BibliotecaModeloStatus" AS ENUM ('RASCUNHO', 'PUBLICADO', 'INATIVO');

-- CreateEnum
CREATE TYPE "BibliotecaVinculoStatus" AS ENUM ('RASCUNHO', 'PUBLICADO', 'INATIVO');

-- AlterTable
ALTER TABLE "PhaseInternalWorkflow" ADD COLUMN "origemBiblioteca" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "PhaseInternalWorkflow_origemBiblioteca_idx" ON "PhaseInternalWorkflow"("origemBiblioteca");

-- CreateTable
CREATE TABLE "BibliotecaModeloTarefa" (
    "id" SERIAL NOT NULL,
    "chave" VARCHAR(60) NOT NULL,
    "workflowId" INTEGER NOT NULL,
    "nome" VARCHAR(200) NOT NULL,
    "descricao" TEXT,
    "status" "BibliotecaModeloStatus" NOT NULL DEFAULT 'RASCUNHO',
    "versaoPublicada" INTEGER,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,
    "criadoPorId" INTEGER,

    CONSTRAINT "BibliotecaModeloTarefa_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BibliotecaVinculo" (
    "id" SERIAL NOT NULL,
    "modeloId" INTEGER NOT NULL,
    "modeloVersao" INTEGER NOT NULL,
    "tipoProcessoId" INTEGER NOT NULL,
    "modalidadeId" INTEGER NOT NULL,
    "phaseKey" VARCHAR(60) NOT NULL,
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "status" "BibliotecaVinculoStatus" NOT NULL DEFAULT 'RASCUNHO',
    "versao" INTEGER NOT NULL DEFAULT 1,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,
    "publicadoEm" TIMESTAMP(3),
    "publicadoPorId" INTEGER,
    "ativo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "BibliotecaVinculo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BibliotecaVinculoVersao" (
    "id" SERIAL NOT NULL,
    "vinculoId" INTEGER NOT NULL,
    "versao" INTEGER NOT NULL,
    "modeloId" INTEGER NOT NULL,
    "modeloVersao" INTEGER NOT NULL,
    "tipoProcessoId" INTEGER NOT NULL,
    "modalidadeId" INTEGER NOT NULL,
    "phaseKey" VARCHAR(60) NOT NULL,
    "ordem" INTEGER NOT NULL,
    "status" "BibliotecaVinculoStatus" NOT NULL,
    "congeladoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "congeladoPorId" INTEGER,
    "origem" VARCHAR(20) NOT NULL,

    CONSTRAINT "BibliotecaVinculoVersao_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BibliotecaModeloTarefa_chave_key" ON "BibliotecaModeloTarefa"("chave");

-- CreateIndex
CREATE UNIQUE INDEX "BibliotecaModeloTarefa_workflowId_key" ON "BibliotecaModeloTarefa"("workflowId");

-- CreateIndex
CREATE INDEX "BibliotecaModeloTarefa_status_idx" ON "BibliotecaModeloTarefa"("status");

-- CreateIndex
CREATE INDEX "BibliotecaVinculo_modeloId_idx" ON "BibliotecaVinculo"("modeloId");

-- CreateIndex
CREATE INDEX "BibliotecaVinculo_phaseKey_idx" ON "BibliotecaVinculo"("phaseKey");

-- CreateIndex
CREATE INDEX "BibliotecaVinculo_tipoProcessoId_modalidadeId_idx" ON "BibliotecaVinculo"("tipoProcessoId", "modalidadeId");

-- CreateIndex
CREATE UNIQUE INDEX "BibliotecaVinculo_tipoProcessoId_modalidadeId_phaseKey_mode_key" ON "BibliotecaVinculo"("tipoProcessoId", "modalidadeId", "phaseKey", "modeloId");

-- CreateIndex
CREATE INDEX "BibliotecaVinculoVersao_vinculoId_idx" ON "BibliotecaVinculoVersao"("vinculoId");

-- CreateIndex
CREATE UNIQUE INDEX "BibliotecaVinculoVersao_vinculoId_versao_key" ON "BibliotecaVinculoVersao"("vinculoId", "versao");

-- AddForeignKey
ALTER TABLE "BibliotecaModeloTarefa" ADD CONSTRAINT "BibliotecaModeloTarefa_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "PhaseInternalWorkflow"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BibliotecaVinculo" ADD CONSTRAINT "BibliotecaVinculo_modeloId_fkey" FOREIGN KEY ("modeloId") REFERENCES "BibliotecaModeloTarefa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BibliotecaVinculo" ADD CONSTRAINT "BibliotecaVinculo_tipoProcessoId_fkey" FOREIGN KEY ("tipoProcessoId") REFERENCES "TipoProcessoNacionalidade"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BibliotecaVinculo" ADD CONSTRAINT "BibliotecaVinculo_modalidadeId_fkey" FOREIGN KEY ("modalidadeId") REFERENCES "ModalidadePais"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BibliotecaVinculoVersao" ADD CONSTRAINT "BibliotecaVinculoVersao_vinculoId_fkey" FOREIGN KEY ("vinculoId") REFERENCES "BibliotecaVinculo"("id") ON DELETE CASCADE ON UPDATE CASCADE;
