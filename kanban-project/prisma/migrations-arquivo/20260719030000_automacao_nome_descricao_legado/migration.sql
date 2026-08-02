-- AUTOMAÇÃO — Nome/Descrição viram LEGADO (aditivo, não destrutivo).
-- A identidade da automação financeira passa a ser 100% ESTRUTURADA (Aplicação +
-- Configuração Financeira + gatilho + fase). Regras NOVAS não preenchem name/descricao.
-- Coluna `name` deixa de ser NOT NULL para permitir gravações sem texto livre.
-- NÃO removemos colunas agora (dados antigos preservados p/ auditoria).

ALTER TABLE "PhaseAutomationRule" ALTER COLUMN "name" DROP NOT NULL;
