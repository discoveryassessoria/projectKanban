-- CONTRACT MIGRATION — remoção física dos models legados Workflow/WorkflowStep.
-- Cutover V2 concluído: zero consumidores operacionais (guarda de CI). Todo o estado
-- operacional está espelhado/reconciliado no runtime V2 (PhaseWorkflowStepInstance
-- com documentoId). NÃO destrói nenhuma estrutura V2. Reversível a partir do backup
-- pg_dump (~/discovery-contract-migration-backup-*). Drop na ordem das FKs.
DROP TABLE IF EXISTS "WorkflowStep";
DROP TABLE IF EXISTS "Workflow";
