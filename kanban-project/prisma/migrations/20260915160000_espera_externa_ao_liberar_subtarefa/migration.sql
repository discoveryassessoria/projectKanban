-- Mesmo cadastro de PhaseInternalWorkflowStep.esperaExternaAoLiberar (migration
-- 20260914194923), um nível abaixo: a SUBTAREFA pode declarar que nasce em
-- espera de terceiro (AGUARDANDO_TERCEIRO) automaticamente quando vira a
-- corrente do passo — sem exigir ação manual do operador. Necessário porque um
-- passo pode agora se decompor em subtarefas sequenciais (ex.: Emissão
-- Documental consolidada num único passo "Solicitar certidão").
-- Aditivo, idempotente: default false preserva o comportamento de toda
-- subtarefa já cadastrada.
ALTER TABLE "StepSubtaskDefinition"
  ADD COLUMN IF NOT EXISTS "esperaExternaAoLiberar" BOOLEAN NOT NULL DEFAULT false;
