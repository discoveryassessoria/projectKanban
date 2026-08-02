-- CP-4A — Runtime de Workflow v2: instâncias, eventos, outbox, versionamento,
-- feature flag. ADITIVA e NÃO-DESTRUTIVA (sem DROP; sem NOT NULL prematuro em
-- FK de ligação; defaults seguros: workflowRuntime="legacy", runtimeV2Habilitado
-- =false, versao=1). ATENÇÃO ROLLBACK: valores adicionados a enum PostgreSQL
-- (StatusTarefa: BLOQUEADA, SUPERSEDIDA) NÃO são removíveis trivialmente — o
-- revert do código não remove os valores do tipo no banco.

-- CreateEnum
CREATE TYPE "PassoTipo" AS ENUM ('HUMANO', 'AUTOMATICO', 'ESPERA', 'VALIDACAO', 'DECISAO', 'APROVACAO', 'MANUAL_SEM_TAREFA');

-- CreateEnum
CREATE TYPE "WorkflowInstanceStatus" AS ENUM ('PENDENTE', 'INSTANCIANDO', 'ATIVO', 'BLOQUEADO', 'AGUARDANDO', 'CONCLUIDO', 'CANCELADO', 'SUPERSEDIDO', 'FALHOU');

-- CreateEnum
CREATE TYPE "StepInstanceStatus" AS ENUM ('PENDENTE', 'DISPONIVEL', 'EM_ANDAMENTO', 'AGUARDANDO', 'BLOQUEADO', 'EXECUTADO', 'AGUARDANDO_APROVACAO', 'CONCLUIDO', 'FALHOU', 'CANCELADO', 'DISPENSADO', 'SUPERSEDIDO');

-- CreateEnum
CREATE TYPE "OrigemInstancia" AS ENUM ('MOTOR', 'MANUAL', 'MIGRACAO', 'REABERTURA');

-- CreateEnum
CREATE TYPE "OutboxStatus" AS ENUM ('PENDENTE', 'ENVIADO', 'ERRO');

-- CreateEnum
CREATE TYPE "WorkflowEventoTipo" AS ENUM ('WORKFLOW_INSTANCIADO', 'WORKFLOW_INICIADO', 'WORKFLOW_BLOQUEADO', 'WORKFLOW_CONCLUIDO', 'WORKFLOW_REABERTO', 'WORKFLOW_SUPERSEDIDO', 'PASSO_INSTANCIADO', 'PASSO_DISPONIBILIZADO', 'PASSO_INICIADO', 'PASSO_BLOQUEADO', 'PASSO_DESBLOQUEADO', 'PASSO_EXECUTADO', 'PASSO_APROVADO', 'PASSO_CONCLUIDO', 'PASSO_FALHOU', 'PASSO_REABERTO', 'PASSO_DISPENSADO', 'PASSO_CANCELADO', 'PASSO_SUPERSEDIDO', 'TAREFA_GERADA', 'TAREFA_ATRIBUIDA', 'TAREFA_CONCLUIDA', 'TAREFA_CANCELADA', 'TAREFA_REABERTA', 'TAREFA_SINCRONIZADA', 'FASE_SIMULADA', 'FASE_AVANCADA', 'FASE_AVANCADA_FORCADO', 'FASE_REABERTA', 'FASE_RETORNADA');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "StatusTarefa" ADD VALUE 'BLOQUEADA';
ALTER TYPE "StatusTarefa" ADD VALUE 'SUPERSEDIDA';

-- AlterTable
ALTER TABLE "Processo" ADD COLUMN     "workflowRuntime" VARCHAR(20) NOT NULL DEFAULT 'legacy';

-- AlterTable
ALTER TABLE "Tarefa" ADD COLUMN     "chaveIdempotencia" VARCHAR(200),
ADD COLUMN     "ciclo" INTEGER,
ADD COLUMN     "correlationId" VARCHAR(60),
ADD COLUMN     "documentoId" INTEGER,
ADD COLUMN     "faseMacroKey" VARCHAR(60),
ADD COLUMN     "necessidadeId" INTEGER,
ADD COLUMN     "origem" VARCHAR(20),
ADD COLUMN     "previousTarefaId" INTEGER,
ADD COLUMN     "taskRole" VARCHAR(40),
ADD COLUMN     "workflowInstanceId" INTEGER,
ADD COLUMN     "workflowStepInstanceId" INTEGER;

-- AlterTable
ALTER TABLE "MacroWorkflow" ADD COLUMN     "versao" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "FaseMacro" ADD COLUMN     "versao" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "PhaseInternalWorkflow" ADD COLUMN     "versao" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "PhaseInternalWorkflowStep" ADD COLUMN     "versao" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "MotorConfig" ADD COLUMN     "runtimeV2Habilitado" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "PhaseWorkflowInstance" (
    "id" SERIAL NOT NULL,
    "processoId" INTEGER NOT NULL,
    "faseMacroKey" VARCHAR(60) NOT NULL,
    "macroWorkflowId" INTEGER,
    "macroVersion" INTEGER,
    "workflowDefinitionId" INTEGER,
    "workflowVersion" INTEGER,
    "snapshot" JSONB,
    "ciclo" INTEGER NOT NULL DEFAULT 1,
    "status" "WorkflowInstanceStatus" NOT NULL DEFAULT 'PENDENTE',
    "origem" "OrigemInstancia" NOT NULL DEFAULT 'MOTOR',
    "instanciadoPor" VARCHAR(60),
    "correlationId" VARCHAR(60),
    "chaveIdempotencia" VARCHAR(200) NOT NULL,
    "previousInstanceId" INTEGER,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "supersededAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PhaseWorkflowInstance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PhaseWorkflowStepInstance" (
    "id" SERIAL NOT NULL,
    "workflowInstanceId" INTEGER NOT NULL,
    "stepDefinitionId" INTEGER,
    "stepDefinitionVersion" INTEGER,
    "stepKey" VARCHAR(80) NOT NULL,
    "snapshot" JSONB,
    "processoId" INTEGER NOT NULL,
    "faseMacroKey" VARCHAR(60) NOT NULL,
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "tipo" "PassoTipo" NOT NULL DEFAULT 'HUMANO',
    "obrigatorio" BOOLEAN NOT NULL DEFAULT true,
    "geraTarefa" BOOLEAN NOT NULL DEFAULT true,
    "necessidadeId" INTEGER,
    "documentoId" INTEGER,
    "ciclo" INTEGER NOT NULL DEFAULT 1,
    "status" "StepInstanceStatus" NOT NULL DEFAULT 'PENDENTE',
    "prioridade" VARCHAR(20),
    "responsavelId" INTEGER,
    "equipe" VARCHAR(120),
    "papel" VARCHAR(80),
    "aprovadorId" INTEGER,
    "slaDays" INTEGER,
    "prazo" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "blockedAt" TIMESTAMP(3),
    "dispensedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "supersededAt" TIMESTAMP(3),
    "motivo" VARCHAR(300),
    "bloqueadoManual" BOOLEAN NOT NULL DEFAULT false,
    "dependeDeStepKeys" JSONB,
    "chaveIdempotencia" VARCHAR(200) NOT NULL,
    "correlationId" VARCHAR(60),
    "previousStepInstanceId" INTEGER,
    "metadata" JSONB,
    "lockVersion" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PhaseWorkflowStepInstance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkflowEvento" (
    "id" SERIAL NOT NULL,
    "tipo" "WorkflowEventoTipo" NOT NULL,
    "entityType" VARCHAR(30) NOT NULL,
    "entityId" INTEGER,
    "processoId" INTEGER,
    "workflowInstanceId" INTEGER,
    "stepInstanceId" INTEGER,
    "tarefaId" INTEGER,
    "correlationId" VARCHAR(60),
    "dados" JSONB,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkflowEvento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DomainOutbox" (
    "id" SERIAL NOT NULL,
    "tipo" VARCHAR(80) NOT NULL,
    "aggregateType" VARCHAR(40),
    "aggregateId" INTEGER,
    "payload" JSONB NOT NULL,
    "correlationId" VARCHAR(60),
    "status" "OutboxStatus" NOT NULL DEFAULT 'PENDENTE',
    "tentativas" INTEGER NOT NULL DEFAULT 0,
    "erro" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processadoEm" TIMESTAMP(3),

    CONSTRAINT "DomainOutbox_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PhaseWorkflowInstance_chaveIdempotencia_key" ON "PhaseWorkflowInstance"("chaveIdempotencia");

-- CreateIndex
CREATE INDEX "PhaseWorkflowInstance_processoId_faseMacroKey_status_idx" ON "PhaseWorkflowInstance"("processoId", "faseMacroKey", "status");

-- CreateIndex
CREATE INDEX "PhaseWorkflowInstance_chaveIdempotencia_idx" ON "PhaseWorkflowInstance"("chaveIdempotencia");

-- CreateIndex
CREATE INDEX "PhaseWorkflowInstance_previousInstanceId_idx" ON "PhaseWorkflowInstance"("previousInstanceId");

-- CreateIndex
CREATE UNIQUE INDEX "PhaseWorkflowStepInstance_chaveIdempotencia_key" ON "PhaseWorkflowStepInstance"("chaveIdempotencia");

-- CreateIndex
CREATE INDEX "PhaseWorkflowStepInstance_workflowInstanceId_ordem_idx" ON "PhaseWorkflowStepInstance"("workflowInstanceId", "ordem");

-- CreateIndex
CREATE INDEX "PhaseWorkflowStepInstance_processoId_faseMacroKey_status_idx" ON "PhaseWorkflowStepInstance"("processoId", "faseMacroKey", "status");

-- CreateIndex
CREATE INDEX "PhaseWorkflowStepInstance_necessidadeId_idx" ON "PhaseWorkflowStepInstance"("necessidadeId");

-- CreateIndex
CREATE INDEX "PhaseWorkflowStepInstance_documentoId_idx" ON "PhaseWorkflowStepInstance"("documentoId");

-- CreateIndex
CREATE INDEX "PhaseWorkflowStepInstance_stepKey_idx" ON "PhaseWorkflowStepInstance"("stepKey");

-- CreateIndex
CREATE INDEX "PhaseWorkflowStepInstance_chaveIdempotencia_idx" ON "PhaseWorkflowStepInstance"("chaveIdempotencia");

-- CreateIndex
CREATE INDEX "WorkflowEvento_entityType_entityId_idx" ON "WorkflowEvento"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "WorkflowEvento_correlationId_idx" ON "WorkflowEvento"("correlationId");

-- CreateIndex
CREATE INDEX "WorkflowEvento_processoId_idx" ON "WorkflowEvento"("processoId");

-- CreateIndex
CREATE INDEX "WorkflowEvento_criadoEm_idx" ON "WorkflowEvento"("criadoEm");

-- CreateIndex
CREATE INDEX "DomainOutbox_status_criadoEm_idx" ON "DomainOutbox"("status", "criadoEm");

-- CreateIndex
CREATE INDEX "DomainOutbox_correlationId_idx" ON "DomainOutbox"("correlationId");

-- CreateIndex
CREATE UNIQUE INDEX "Tarefa_chaveIdempotencia_key" ON "Tarefa"("chaveIdempotencia");

-- CreateIndex
CREATE INDEX "Tarefa_workflowStepInstanceId_idx" ON "Tarefa"("workflowStepInstanceId");

-- CreateIndex
CREATE INDEX "Tarefa_workflowInstanceId_idx" ON "Tarefa"("workflowInstanceId");

-- CreateIndex
CREATE INDEX "Tarefa_necessidadeId_idx" ON "Tarefa"("necessidadeId");

-- AddForeignKey
ALTER TABLE "Tarefa" ADD CONSTRAINT "Tarefa_workflowInstanceId_fkey" FOREIGN KEY ("workflowInstanceId") REFERENCES "PhaseWorkflowInstance"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Tarefa" ADD CONSTRAINT "Tarefa_workflowStepInstanceId_fkey" FOREIGN KEY ("workflowStepInstanceId") REFERENCES "PhaseWorkflowStepInstance"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Tarefa" ADD CONSTRAINT "Tarefa_necessidadeId_fkey" FOREIGN KEY ("necessidadeId") REFERENCES "NecessidadeDocumental"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Tarefa" ADD CONSTRAINT "Tarefa_documentoId_fkey" FOREIGN KEY ("documentoId") REFERENCES "Documento"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Tarefa" ADD CONSTRAINT "Tarefa_previousTarefaId_fkey" FOREIGN KEY ("previousTarefaId") REFERENCES "Tarefa"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhaseWorkflowInstance" ADD CONSTRAINT "PhaseWorkflowInstance_processoId_fkey" FOREIGN KEY ("processoId") REFERENCES "Processo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhaseWorkflowInstance" ADD CONSTRAINT "PhaseWorkflowInstance_previousInstanceId_fkey" FOREIGN KEY ("previousInstanceId") REFERENCES "PhaseWorkflowInstance"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhaseWorkflowStepInstance" ADD CONSTRAINT "PhaseWorkflowStepInstance_workflowInstanceId_fkey" FOREIGN KEY ("workflowInstanceId") REFERENCES "PhaseWorkflowInstance"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhaseWorkflowStepInstance" ADD CONSTRAINT "PhaseWorkflowStepInstance_necessidadeId_fkey" FOREIGN KEY ("necessidadeId") REFERENCES "NecessidadeDocumental"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhaseWorkflowStepInstance" ADD CONSTRAINT "PhaseWorkflowStepInstance_documentoId_fkey" FOREIGN KEY ("documentoId") REFERENCES "Documento"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhaseWorkflowStepInstance" ADD CONSTRAINT "PhaseWorkflowStepInstance_previousStepInstanceId_fkey" FOREIGN KEY ("previousStepInstanceId") REFERENCES "PhaseWorkflowStepInstance"("id") ON DELETE SET NULL ON UPDATE CASCADE;

