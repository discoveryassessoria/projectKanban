-- A POLÍTICA DE REABERTURA VIRA CADASTRO.
--
-- Reabrir uma etapa concluída sempre foi possível no motor, e nunca foi uma decisão
-- declarada: se podia, quem podia, se exigia justificativa e o que acontecia com os
-- dependentes eram respostas do código — não do administrador.
--
-- Os defaults reproduzem exatamente o comportamento de hoje (permitido, escolha
-- manual, justificativa exigida), então nenhuma etapa muda de comportamento por
-- efeito desta migration. O que muda é poder mudar.
ALTER TABLE "PhaseInternalWorkflowStep" ADD COLUMN "reaberturaPermitida" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "PhaseInternalWorkflowStep" ADD COLUMN "reaberturaEstrategia" VARCHAR(24) NOT NULL DEFAULT 'ESCOLHA_MANUAL';
ALTER TABLE "PhaseInternalWorkflowStep" ADD COLUMN "reaberturaExigeJustificativa" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "PhaseInternalWorkflowStep" ADD COLUMN "reaberturaPermissao" VARCHAR(60);

-- A estratégia é um vocabulário fechado: um valor fora dele faria a tela propor algo
-- que o motor não sabe executar.
ALTER TABLE "PhaseInternalWorkflowStep" ADD CONSTRAINT "PhaseInternalWorkflowStep_reabertura_estrategia"
    CHECK ("reaberturaEstrategia" IN ('SOMENTE_ESTA', 'ESTA_E_DEPENDENTES', 'ESCOLHA_MANUAL'));
