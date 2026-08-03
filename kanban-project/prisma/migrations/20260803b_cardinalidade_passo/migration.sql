-- Separa DEFINITIVAMENTE dois conceitos que estavam colados na coluna "escopo":
--
--   • COMPARTILHAMENTO DO WORKFLOW — já existia e permanece intocado:
--     PhaseInternalWorkflow.tipoProcessoId = null significa "global (compartilhado)",
--     isto é, o workflow serve a todos os tipos de processo. Não diz nada sobre
--     quantas instâncias operacionais um passo gera.
--
--   • CARDINALIDADE OPERACIONAL DO PASSO — quantas instâncias e presas a QUAL
--     entidade. É esta coluna.
--
-- NULL = herda o escopo operacional canônico da FASE (fases-catalog). Um valor
-- explícito sobrepõe. Nenhuma linha existente é apagada.

ALTER TABLE "PhaseInternalWorkflowStep"
  RENAME COLUMN "escopo" TO "cardinalidade";

ALTER TABLE "PhaseInternalWorkflowStep"
  ALTER COLUMN "cardinalidade" DROP NOT NULL;

ALTER TABLE "PhaseInternalWorkflowStep"
  ALTER COLUMN "cardinalidade" DROP DEFAULT;

-- 'GLOBAL' foi um default equivocado introduzido no mesmo dia: colava a
-- cardinalidade do passo ao rótulo de compartilhamento do workflow. Volta a NULL
-- (= herda a fase), que é o comportamento correto e o que havia antes.
UPDATE "PhaseInternalWorkflowStep" SET "cardinalidade" = NULL WHERE "cardinalidade" = 'GLOBAL';
