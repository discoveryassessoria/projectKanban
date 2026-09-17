-- OBRIGAÇÃO ADMINISTRATIVA (17/09/2026) — novo valor de TipoTarefa para
-- representar trabalho de GERIR a operação (ex.: distribuir tarefas sem
-- responsável), nunca do Workflow Interno da certidão. Ver
-- lib/operacional/obrigacao-atribuicao.ts. Puramente aditivo: nenhum valor
-- existente é alterado ou removido.

ALTER TYPE "TipoTarefa" ADD VALUE IF NOT EXISTS 'ADMINISTRATIVA';
