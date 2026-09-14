-- Cadastro canônico: o passo pode declarar que nasce em espera de terceiro
-- (AGUARDANDO_TERCEIRO) automaticamente no instante em que é liberado como
-- corrente da Tarefa — sem exigir ação manual do operador.
-- Aditivo, idempotente: default false preserva o comportamento de todo
-- passo já cadastrado.
ALTER TABLE "PhaseInternalWorkflowStep"
  ADD COLUMN IF NOT EXISTS "esperaExternaAoLiberar" BOOLEAN NOT NULL DEFAULT false;
