-- CP-4B — identidade da fase (faseMacroId/Version), snapshotSchemaVersion,
-- causationId e chaveIdempotencia de dedup em evento/outbox.
-- ADITIVA e NÃO-DESTRUTIVA: só ADD COLUMN + índices únicos. Sem DROP.
-- snapshotSchemaVersion é NOT NULL mas com DEFAULT 1 (seguro p/ linhas
-- existentes). Nenhuma FK nova obrigatória; nenhuma ativação de runtime.

-- AlterTable
ALTER TABLE "PhaseWorkflowInstance" ADD COLUMN     "causationId" VARCHAR(60),
ADD COLUMN     "faseMacroId" INTEGER,
ADD COLUMN     "faseMacroVersion" INTEGER,
ADD COLUMN     "snapshotSchemaVersion" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "PhaseWorkflowStepInstance" ADD COLUMN     "causationId" VARCHAR(60),
ADD COLUMN     "snapshotSchemaVersion" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "WorkflowEvento" ADD COLUMN     "causationId" VARCHAR(60),
ADD COLUMN     "chaveIdempotencia" VARCHAR(200);

-- AlterTable
ALTER TABLE "DomainOutbox" ADD COLUMN     "causationId" VARCHAR(60),
ADD COLUMN     "chaveIdempotencia" VARCHAR(200);

-- CreateIndex
CREATE UNIQUE INDEX "WorkflowEvento_chaveIdempotencia_key" ON "WorkflowEvento"("chaveIdempotencia");

-- CreateIndex
CREATE UNIQUE INDEX "DomainOutbox_chaveIdempotencia_key" ON "DomainOutbox"("chaveIdempotencia");
