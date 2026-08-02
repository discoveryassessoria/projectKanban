-- Widening NÃO-destrutivo de causationId VarChar(60) → VarChar(200).
-- Motivo: a chave idempotente do PhaseAdvanceService (montarChaveAdvance) chega a
-- ~64–74 chars na transição genealogia → emissao_documental (nomes de fase longos),
-- gravada como causationId dos eventos/logs/outbox. VarChar(60) causava P2000
-- ("value too long") e ABORTAVA o avanço de fase. 200 = mesmo tamanho de chaveIdempotencia.
-- Apenas amplia o tipo; nenhum dado é alterado ou removido.

ALTER TABLE "PhaseWorkflowInstance"     ALTER COLUMN "causationId" TYPE VARCHAR(200);
ALTER TABLE "PhaseWorkflowStepInstance" ALTER COLUMN "causationId" TYPE VARCHAR(200);
ALTER TABLE "WorkflowEvento"            ALTER COLUMN "causationId" TYPE VARCHAR(200);
ALTER TABLE "PhaseAdvanceLog"           ALTER COLUMN "causationId" TYPE VARCHAR(200);
ALTER TABLE "DomainOutbox"              ALTER COLUMN "causationId" TYPE VARCHAR(200);
