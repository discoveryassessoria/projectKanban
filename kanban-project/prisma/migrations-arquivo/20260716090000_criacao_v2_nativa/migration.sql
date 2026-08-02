-- Criação V2-nativa de processos:
--  (1) todo processo novo nasce em runtime "v2" (default trocado de "legacy");
--  (2) idempotência da criação (evita duplicar em duplo clique/retry);
--  (3) snapshot imutável da versão do Workflow Macro aplicada no nascimento.

ALTER TABLE "Processo" ALTER COLUMN "workflowRuntime" SET DEFAULT 'v2';

ALTER TABLE "Processo" ADD COLUMN "chaveIdempotenciaCriacao" VARCHAR(200);
ALTER TABLE "Processo" ADD COLUMN "macroWorkflowVersion" INTEGER;

CREATE UNIQUE INDEX "Processo_chaveIdempotenciaCriacao_key" ON "Processo"("chaveIdempotenciaCriacao");
