-- CreateEnum
CREATE TYPE "StatusOperacaoAntecipada" AS ENUM ('CRIADA', 'EM_EXECUCAO', 'AGUARDANDO_RESULTADO', 'CONCLUIDA', 'CONCLUIDA_PARCIAL', 'NAO_ATINGIDA', 'CANCELADA');

-- CreateTable
CREATE TABLE "OperacaoAntecipada" (
    "id" SERIAL NOT NULL,
    "processoId" INTEGER NOT NULL,
    "workflowInstanceId" INTEGER,
    "originPhaseCode" VARCHAR(60),
    "originStepKey" VARCHAR(80),
    "necessidadeId" INTEGER,
    "targetPhaseCode" VARCHAR(60),
    "targetWorkflowDefinitionId" VARCHAR(80),
    "targetOperationType" VARCHAR(40) NOT NULL,
    "targetOperationId" INTEGER,
    "objetivo" TEXT,
    "resultadoEsperado" TEXT,
    "resultadoObtido" TEXT,
    "status" "StatusOperacaoAntecipada" NOT NULL DEFAULT 'CRIADA',
    "responsavelId" INTEGER,
    "createdBy" INTEGER,
    "avaliadoPor" INTEGER,
    "avaliadoEm" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),

    CONSTRAINT "OperacaoAntecipada_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OperacaoAntecipada_processoId_idx" ON "OperacaoAntecipada"("processoId");
CREATE INDEX "OperacaoAntecipada_necessidadeId_idx" ON "OperacaoAntecipada"("necessidadeId");
CREATE INDEX "OperacaoAntecipada_targetOperationType_targetOperationId_idx" ON "OperacaoAntecipada"("targetOperationType", "targetOperationId");
CREATE INDEX "OperacaoAntecipada_status_idx" ON "OperacaoAntecipada"("status");
