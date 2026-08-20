-- TENTATIVA DE EXECUÇÃO DO PASSO (Gate 2).
--
-- A execução da FASE já existia (`PhaseWorkflowInstance.ciclo` + `previousInstanceId`).
-- Faltava a tentativa DO PASSO: reabrir fazia `completedAt = NULL` na própria linha,
-- e a execução que aconteceu deixava de ter acontecido.
--
-- ADITIVO: uma tabela nova. Nenhuma coluna alterada, nenhuma linha tocada.
CREATE TABLE "StepExecution" (
    "id" SERIAL NOT NULL,
    "stepInstanceId" INTEGER NOT NULL,
    "sequencia" INTEGER NOT NULL,
    "status" "StepInstanceStatus" NOT NULL,
    "motivo" VARCHAR(30) NOT NULL,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "executadoPorId" INTEGER,
    "resultado" VARCHAR(60),
    "payload" JSONB,
    "supersededAt" TIMESTAMP(3),
    "supersededPorId" INTEGER,
    "correlationId" VARCHAR(60),
    "chaveIdempotencia" VARCHAR(200) NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StepExecution_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "StepExecution_chaveIdempotencia_key" ON "StepExecution"("chaveIdempotencia");
CREATE UNIQUE INDEX "StepExecution_stepInstanceId_sequencia_key" ON "StepExecution"("stepInstanceId", "sequencia");
CREATE INDEX "StepExecution_stepInstanceId_idx" ON "StepExecution"("stepInstanceId");

-- A TENTATIVA VIGENTE É ÚNICA, E QUEM GARANTE É O BANCO.
-- Índice parcial: no máximo uma tentativa não-substituída por passo. É isto que faz
-- "qual é a execução atual?" ter resposta determinística, em vez de depender de
-- `ORDER BY createdAt DESC` — e é o que impede dois reopen concorrentes de criarem
-- duas correntes.
CREATE UNIQUE INDEX "StepExecution_uma_vigente_por_passo"
    ON "StepExecution"("stepInstanceId") WHERE "supersededAt" IS NULL;

ALTER TABLE "StepExecution"
    ADD CONSTRAINT "StepExecution_stepInstanceId_fkey"
    FOREIGN KEY ("stepInstanceId") REFERENCES "PhaseWorkflowStepInstance"("id") ON DELETE CASCADE ON UPDATE CASCADE;
