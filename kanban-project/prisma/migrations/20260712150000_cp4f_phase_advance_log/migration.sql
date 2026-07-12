-- CP-4F — PhaseAdvanceLog (auditoria de mudança de fase) + Processo.lockVersion (CAS).
-- ADITIVA e NÃO-DESTRUTIVA: CreateEnum + CreateTable + ADD COLUMN. Sem DROP.
-- lockVersion é NOT NULL com DEFAULT 0 (seguro p/ linhas existentes).
-- processoId em PhaseAdvanceLog é solto (sem FK), para o log sobreviver a
-- alterações e não impor FK sobre dados existentes.
-- ATENÇÃO ROLLBACK: valores de enum PostgreSQL não são removíveis trivialmente.

-- CreateEnum
CREATE TYPE "AdvanceResultado" AS ENUM ('BLOQUEADO', 'AVANCADO', 'FORCADO', 'REABERTO', 'RETORNADO', 'IDEMPOTENTE', 'CONFLITO');

-- AlterTable
ALTER TABLE "Processo" ADD COLUMN     "lockVersion" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "PhaseAdvanceLog" (
    "id" SERIAL NOT NULL,
    "processoId" INTEGER NOT NULL,
    "faseAtual" VARCHAR(60) NOT NULL,
    "fasePretendida" VARCHAR(60),
    "faseAnteriorId" INTEGER,
    "fasePretendidaId" INTEGER,
    "macroWorkflowId" INTEGER,
    "macroVersion" INTEGER,
    "internalWorkflowVersion" INTEGER,
    "policy" VARCHAR(40) NOT NULL DEFAULT 'ALL_REQUIRED_COMPLETED',
    "regrasAvaliadas" JSONB NOT NULL,
    "pendencias" JSONB NOT NULL,
    "warnings" JSONB,
    "resultado" "AdvanceResultado" NOT NULL,
    "origem" VARCHAR(20) NOT NULL,
    "solicitadoPorId" INTEGER,
    "justificativa" TEXT,
    "motivoCodigo" VARCHAR(40),
    "forcado" BOOLEAN NOT NULL DEFAULT false,
    "correlationId" VARCHAR(60) NOT NULL,
    "causationId" VARCHAR(60),
    "chaveIdempotencia" VARCHAR(200) NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PhaseAdvanceLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PhaseAdvanceLog_chaveIdempotencia_key" ON "PhaseAdvanceLog"("chaveIdempotencia");

-- CreateIndex
CREATE INDEX "PhaseAdvanceLog_processoId_idx" ON "PhaseAdvanceLog"("processoId");

-- CreateIndex
CREATE INDEX "PhaseAdvanceLog_correlationId_idx" ON "PhaseAdvanceLog"("correlationId");

-- CreateIndex
CREATE INDEX "PhaseAdvanceLog_criadoEm_idx" ON "PhaseAdvanceLog"("criadoEm");

-- CreateIndex
CREATE INDEX "PhaseAdvanceLog_resultado_idx" ON "PhaseAdvanceLog"("resultado");
