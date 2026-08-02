-- CreateEnum
CREATE TYPE "FaseCode" AS ENUM (
  'GENEALOGIA',
  'EMISSAO_DOCUMENTAL',
  'ANALISE_DOCUMENTAL',
  'RETIFICACAO_REGISTROS',
  'EMISSAO_DOCUMENTAL_RETIFICADA',
  'TRADUCAO_JURAMENTADA',
  'APOSTILAMENTO',
  'AGUARDANDO_PROTOCOLO',
  'PROTOCOLADO',
  'FINALIZADO'
);

-- AlterTable: Status ganha faseCode (nullable, não quebra linhas existentes)
ALTER TABLE "Status" ADD COLUMN "faseCode" "FaseCode";
CREATE INDEX "Status_faseCode_idx" ON "Status"("faseCode");

-- AlterTable: Workflow ganha faseCode
ALTER TABLE "Workflow" ADD COLUMN "faseCode" "FaseCode";
CREATE INDEX "Workflow_faseCode_idx" ON "Workflow"("faseCode");