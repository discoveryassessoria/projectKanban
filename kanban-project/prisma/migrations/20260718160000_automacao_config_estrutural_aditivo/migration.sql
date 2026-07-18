-- AUTOMAÇÃO FINANCEIRA — vínculo ESTRUTURAL (aditivo, não destrutivo).
-- A automação (PhaseAutomationRule kind=financial) deixa de guardar preço/moeda/valor:
-- aponta para a Configuração Financeira (configItemId) e declara a direção
-- (aplicacaoFinanceira). Colunas legadas (financialType/params.amount/currency) são
-- PRESERVADAS para leitura das regras antigas. Nada é apagado nem reescrito.

ALTER TABLE "PhaseAutomationRule" ADD COLUMN "configItemId" INTEGER;
ALTER TABLE "PhaseAutomationRule" ADD COLUMN "aplicacaoFinanceira" VARCHAR(10);

CREATE INDEX "PhaseAutomationRule_configItemId_idx" ON "PhaseAutomationRule"("configItemId");
