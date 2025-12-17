/*
  Warnings:

  - You are about to drop the column `projetoId` on the `Status` table. All the data in the column will be lost.
  - You are about to drop the `Atividade` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `ProjetoKanban` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `ProjetoRequerente` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `UserAtv` table. If the table is not empty, all the data it contains will be lost.
  - A unique constraint covering the columns `[nome,pais]` on the table `Status` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `updatedAt` to the `Contratante` table without a default value. This is not possible if the table is not empty.
  - Added the required column `updatedAt` to the `Requerente` table without a default value. This is not possible if the table is not empty.
  - Added the required column `pais` to the `Status` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "public"."Pais" AS ENUM ('PORTUGAL', 'ESPANHA', 'ALEMANHA', 'ITALIA');

-- CreateEnum
CREATE TYPE "public"."PrioridadeTarefa" AS ENUM ('BAIXA', 'MEDIA', 'ALTA', 'URGENTE');

-- DropForeignKey
ALTER TABLE "public"."Atividade" DROP CONSTRAINT "Atividade_arvore_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."Atividade" DROP CONSTRAINT "Atividade_projetoId_fkey";

-- DropForeignKey
ALTER TABLE "public"."Atividade" DROP CONSTRAINT "Atividade_statusId_fkey";

-- DropForeignKey
ALTER TABLE "public"."ProjetoKanban" DROP CONSTRAINT "ProjetoKanban_contratanteId_fkey";

-- DropForeignKey
ALTER TABLE "public"."ProjetoRequerente" DROP CONSTRAINT "ProjetoRequerente_projetoId_fkey";

-- DropForeignKey
ALTER TABLE "public"."ProjetoRequerente" DROP CONSTRAINT "ProjetoRequerente_requerenteId_fkey";

-- DropForeignKey
ALTER TABLE "public"."Status" DROP CONSTRAINT "Status_projetoId_fkey";

-- DropForeignKey
ALTER TABLE "public"."UserAtv" DROP CONSTRAINT "UserAtv_atividadeId_fkey";

-- DropForeignKey
ALTER TABLE "public"."UserAtv" DROP CONSTRAINT "UserAtv_usuarioId_fkey";

-- AlterTable
ALTER TABLE "public"."Contratante" ADD COLUMN     "bairro" VARCHAR(100),
ADD COLUMN     "cep" VARCHAR(10),
ADD COLUMN     "cidade" VARCHAR(100),
ADD COLUMN     "complemento" VARCHAR(100),
ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "dataNascimento" TIMESTAMP(3),
ADD COLUMN     "email" VARCHAR(100),
ADD COLUMN     "estado" VARCHAR(2),
ADD COLUMN     "estadoCivil" VARCHAR(20),
ADD COLUMN     "nacionalidade" VARCHAR(50),
ADD COLUMN     "numero" VARCHAR(20),
ADD COLUMN     "observacoes" TEXT,
ADD COLUMN     "sexo" VARCHAR(20),
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL,
ALTER COLUMN "nome" SET DATA TYPE VARCHAR(100),
ALTER COLUMN "cpf" SET DATA TYPE VARCHAR(14),
ALTER COLUMN "rg" SET DATA TYPE VARCHAR(20),
ALTER COLUMN "endereco" SET DATA TYPE VARCHAR(200),
ALTER COLUMN "telefone" SET DATA TYPE VARCHAR(20);

-- AlterTable
ALTER TABLE "public"."Requerente" ADD COLUMN     "bairro" VARCHAR(100),
ADD COLUMN     "cep" VARCHAR(10),
ADD COLUMN     "cidade" VARCHAR(100),
ADD COLUMN     "complemento" VARCHAR(100),
ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "dataNascimento" TIMESTAMP(3),
ADD COLUMN     "email" VARCHAR(100),
ADD COLUMN     "estado" VARCHAR(2),
ADD COLUMN     "estadoCivil" VARCHAR(20),
ADD COLUMN     "nacionalidade" VARCHAR(50),
ADD COLUMN     "numero" VARCHAR(20),
ADD COLUMN     "observacoes" TEXT,
ADD COLUMN     "sexo" VARCHAR(20),
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL,
ALTER COLUMN "nome" SET DATA TYPE VARCHAR(100),
ALTER COLUMN "cpf" SET DATA TYPE VARCHAR(14),
ALTER COLUMN "rg" SET DATA TYPE VARCHAR(20),
ALTER COLUMN "endereco" SET DATA TYPE VARCHAR(200),
ALTER COLUMN "telefone" SET DATA TYPE VARCHAR(20);

-- AlterTable
ALTER TABLE "public"."Status" DROP COLUMN "projetoId",
ADD COLUMN     "pais" "public"."Pais" NOT NULL,
ALTER COLUMN "nome" SET DATA TYPE VARCHAR(50);

-- DropTable
DROP TABLE "public"."Atividade";

-- DropTable
DROP TABLE "public"."ProjetoKanban";

-- DropTable
DROP TABLE "public"."ProjetoRequerente";

-- DropTable
DROP TABLE "public"."UserAtv";

-- CreateTable
CREATE TABLE "public"."Processo" (
    "id" SERIAL NOT NULL,
    "nome" VARCHAR(100) NOT NULL,
    "descricao" VARCHAR(500),
    "observacoes" TEXT,
    "pais" "public"."Pais" NOT NULL,
    "statusId" INTEGER NOT NULL,
    "contratanteId" INTEGER,
    "arvoreId" INTEGER,
    "dataInicio" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "previsaoTermino" TIMESTAMP(3),
    "dataConclusao" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Processo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Tarefa" (
    "id" SERIAL NOT NULL,
    "titulo" VARCHAR(200) NOT NULL,
    "descricao" TEXT,
    "processoId" INTEGER NOT NULL,
    "responsavelId" INTEGER,
    "concluida" BOOLEAN NOT NULL DEFAULT false,
    "prioridade" "public"."PrioridadeTarefa" NOT NULL DEFAULT 'MEDIA',
    "dataPrazo" TIMESTAMP(3),
    "dataConclusao" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Tarefa_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ProcessoRequerente" (
    "processoId" INTEGER NOT NULL,
    "requerenteId" INTEGER NOT NULL,

    CONSTRAINT "ProcessoRequerente_pkey" PRIMARY KEY ("processoId","requerenteId")
);

-- CreateTable
CREATE TABLE "public"."AnexoProcesso" (
    "id" SERIAL NOT NULL,
    "nome" VARCHAR(200) NOT NULL,
    "tipo" VARCHAR(50) NOT NULL,
    "nomeArquivo" VARCHAR(300) NOT NULL,
    "urlArquivo" TEXT NOT NULL,
    "tamanho" INTEGER,
    "mimeType" VARCHAR(100),
    "processoId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnexoProcesso_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."AnexoContratante" (
    "id" SERIAL NOT NULL,
    "nome" VARCHAR(200) NOT NULL,
    "tipo" VARCHAR(50) NOT NULL,
    "nomeArquivo" VARCHAR(300) NOT NULL,
    "urlArquivo" TEXT NOT NULL,
    "tamanho" INTEGER,
    "mimeType" VARCHAR(100),
    "contratanteId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnexoContratante_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."AnexoRequerente" (
    "id" SERIAL NOT NULL,
    "nome" VARCHAR(200) NOT NULL,
    "tipo" VARCHAR(50) NOT NULL,
    "nomeArquivo" VARCHAR(300) NOT NULL,
    "urlArquivo" TEXT NOT NULL,
    "tamanho" INTEGER,
    "mimeType" VARCHAR(100),
    "requerenteId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnexoRequerente_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."LogAuditoria" (
    "id" SERIAL NOT NULL,
    "acao" VARCHAR(50) NOT NULL,
    "entidade" VARCHAR(50) NOT NULL,
    "entidadeId" INTEGER,
    "descricao" TEXT NOT NULL,
    "detalhes" JSONB,
    "usuarioId" INTEGER,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LogAuditoria_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Processo_pais_idx" ON "public"."Processo"("pais");

-- CreateIndex
CREATE INDEX "Processo_statusId_idx" ON "public"."Processo"("statusId");

-- CreateIndex
CREATE INDEX "Processo_contratanteId_idx" ON "public"."Processo"("contratanteId");

-- CreateIndex
CREATE INDEX "Tarefa_processoId_idx" ON "public"."Tarefa"("processoId");

-- CreateIndex
CREATE INDEX "Tarefa_responsavelId_idx" ON "public"."Tarefa"("responsavelId");

-- CreateIndex
CREATE INDEX "Tarefa_concluida_idx" ON "public"."Tarefa"("concluida");

-- CreateIndex
CREATE INDEX "AnexoProcesso_processoId_idx" ON "public"."AnexoProcesso"("processoId");

-- CreateIndex
CREATE INDEX "AnexoContratante_contratanteId_idx" ON "public"."AnexoContratante"("contratanteId");

-- CreateIndex
CREATE INDEX "AnexoRequerente_requerenteId_idx" ON "public"."AnexoRequerente"("requerenteId");

-- CreateIndex
CREATE INDEX "LogAuditoria_entidade_idx" ON "public"."LogAuditoria"("entidade");

-- CreateIndex
CREATE INDEX "LogAuditoria_usuarioId_idx" ON "public"."LogAuditoria"("usuarioId");

-- CreateIndex
CREATE INDEX "LogAuditoria_criadoEm_idx" ON "public"."LogAuditoria"("criadoEm");

-- CreateIndex
CREATE INDEX "Status_pais_idx" ON "public"."Status"("pais");

-- CreateIndex
CREATE UNIQUE INDEX "Status_nome_pais_key" ON "public"."Status"("nome", "pais");

-- AddForeignKey
ALTER TABLE "public"."Processo" ADD CONSTRAINT "Processo_statusId_fkey" FOREIGN KEY ("statusId") REFERENCES "public"."Status"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Processo" ADD CONSTRAINT "Processo_contratanteId_fkey" FOREIGN KEY ("contratanteId") REFERENCES "public"."Contratante"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Processo" ADD CONSTRAINT "Processo_arvoreId_fkey" FOREIGN KEY ("arvoreId") REFERENCES "public"."Arvore"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Tarefa" ADD CONSTRAINT "Tarefa_processoId_fkey" FOREIGN KEY ("processoId") REFERENCES "public"."Processo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Tarefa" ADD CONSTRAINT "Tarefa_responsavelId_fkey" FOREIGN KEY ("responsavelId") REFERENCES "public"."Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ProcessoRequerente" ADD CONSTRAINT "ProcessoRequerente_processoId_fkey" FOREIGN KEY ("processoId") REFERENCES "public"."Processo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ProcessoRequerente" ADD CONSTRAINT "ProcessoRequerente_requerenteId_fkey" FOREIGN KEY ("requerenteId") REFERENCES "public"."Requerente"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."AnexoProcesso" ADD CONSTRAINT "AnexoProcesso_processoId_fkey" FOREIGN KEY ("processoId") REFERENCES "public"."Processo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."AnexoContratante" ADD CONSTRAINT "AnexoContratante_contratanteId_fkey" FOREIGN KEY ("contratanteId") REFERENCES "public"."Contratante"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."AnexoRequerente" ADD CONSTRAINT "AnexoRequerente_requerenteId_fkey" FOREIGN KEY ("requerenteId") REFERENCES "public"."Requerente"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."LogAuditoria" ADD CONSTRAINT "LogAuditoria_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "public"."Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;
