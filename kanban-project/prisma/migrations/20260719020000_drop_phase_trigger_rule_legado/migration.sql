-- REMOÇÃO DO LEGADO: PhaseTriggerRule (automação financeira por CÓDIGO) foi
-- descontinuada e substituída por automações financeiras (PhaseAutomationRule) com
-- vínculo estrutural (configItemId) + preço da Tabela de Preços. Tabela VAZIA em prod
-- (0 linhas) — o DROP não perde dado. IF EXISTS torna a migração segura/reexecutável.

DROP TABLE IF EXISTS "PhaseTriggerRule" CASCADE;
