-- VERSÃO PUBLICADA IMUTÁVEL (Gate 1).
--
-- As instâncias já registravam `workflowDefinitionId` + `workflowVersion`. O que não
-- existia era o CONTEÚDO daquela versão: `versao` nunca era incrementada e a edição
-- apagava e recriava os passos, então o par apontava para algo que mudava por baixo.
--
-- ADITIVO: uma tabela nova. Nenhuma coluna alterada, nenhuma linha tocada, nenhum
-- processo migrado. O backfill de V1 é feito por script auditado, fora da migration,
-- para que a leitura do que foi congelado seja verificável antes de valer.
CREATE TABLE "PhaseInternalWorkflowVersao" (
    "id" SERIAL NOT NULL,
    "workflowId" INTEGER NOT NULL,
    "versao" INTEGER NOT NULL,
    "phaseKey" VARCHAR(60) NOT NULL,
    "tipoProcessoId" INTEGER,
    "name" VARCHAR(200) NOT NULL,
    "execucao" VARCHAR(20) NOT NULL,
    "escopoExecucao" "EscopoExecucao",
    "familiaDocumentalId" INTEGER,
    "exigeDocumento" BOOLEAN NOT NULL DEFAULT false,
    "exigePessoa" BOOLEAN NOT NULL DEFAULT false,
    "pausarSlaEmEsperaExterna" BOOLEAN NOT NULL DEFAULT false,
    "pausarSlaEmBloqueio" BOOLEAN NOT NULL DEFAULT false,
    "passos" JSONB NOT NULL,
    "congeladoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "congeladoPorId" INTEGER,
    "origem" VARCHAR(20) NOT NULL,
    CONSTRAINT "PhaseInternalWorkflowVersao_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PhaseInternalWorkflowVersao_workflowId_versao_key"
    ON "PhaseInternalWorkflowVersao"("workflowId", "versao");
CREATE INDEX "PhaseInternalWorkflowVersao_workflowId_idx"
    ON "PhaseInternalWorkflowVersao"("workflowId");

ALTER TABLE "PhaseInternalWorkflowVersao"
    ADD CONSTRAINT "PhaseInternalWorkflowVersao_workflowId_fkey"
    FOREIGN KEY ("workflowId") REFERENCES "PhaseInternalWorkflow"("id") ON DELETE CASCADE ON UPDATE CASCADE;
