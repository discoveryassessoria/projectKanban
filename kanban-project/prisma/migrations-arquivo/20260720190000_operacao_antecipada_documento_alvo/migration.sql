-- AlterTable (aditivo)
ALTER TABLE "OperacaoAntecipada"
  ADD COLUMN "targetTipoDocumentoId" INTEGER,
  ADD COLUMN "params" JSONB,
  ADD COLUMN "resultadoDados" JSONB;

-- CreateIndex
CREATE INDEX "OperacaoAntecipada_targetTipoDocumentoId_idx" ON "OperacaoAntecipada"("targetTipoDocumentoId");

-- CreateIndex (idempotência do documento-alvo explícito; NULLs distintos)
CREATE UNIQUE INDEX "OperacaoAntecipada_processoId_necessidadeId_targetOperationT_key" ON "OperacaoAntecipada"("processoId", "necessidadeId", "targetOperationType", "targetTipoDocumentoId");
