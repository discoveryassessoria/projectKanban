-- A IDENTIDADE DE UMA PEÇA É ÚNICA DENTRO DO DONO DELA — não do passo inteiro.
--
-- `@@unique([stepId, key])` exigia que a chave fosse única no passo INTEIRO. Com a
-- subtarefa, isso vira uma trava sem sentido: duas subtarefas do mesmo passo não
-- poderiam ter, cada uma, um campo "observacao", e uma subtarefa não poderia usar uma
-- chave que o passo já usa. São peças de donos diferentes.
--
-- A troca não pode ser por `UNIQUE (stepId, subtaskId, key)`: no Postgres, NULL é
-- distinto de NULL, então as peças DO PASSO (subtaskId nulo) deixariam de ser
-- deduplicadas — e o passo passaria a aceitar dois campos com a mesma chave, que é
-- exatamente o que a trava existia para impedir.
--
-- Por isso são DOIS índices parciais, um para cada dono.

-- ── AÇÕES ───────────────────────────────────────────────────────────────────
DROP INDEX IF EXISTS "StepAction_stepId_key_key";
CREATE UNIQUE INDEX "StepAction_key_unica_no_passo"
    ON "StepAction"("stepId", "key") WHERE "subtaskId" IS NULL;
CREATE UNIQUE INDEX "StepAction_key_unica_na_subtarefa"
    ON "StepAction"("subtaskId", "key") WHERE "subtaskId" IS NOT NULL;

-- ── CAMPOS ──────────────────────────────────────────────────────────────────
DROP INDEX IF EXISTS "StepField_stepId_key_key";
CREATE UNIQUE INDEX "StepField_key_unica_no_passo"
    ON "StepField"("stepId", "key") WHERE "subtaskId" IS NULL;
CREATE UNIQUE INDEX "StepField_key_unica_na_subtarefa"
    ON "StepField"("subtaskId", "key") WHERE "subtaskId" IS NOT NULL;

-- ── CHECKLIST ───────────────────────────────────────────────────────────────
DROP INDEX IF EXISTS "StepChecklistItem_stepId_key_key";
CREATE UNIQUE INDEX "StepChecklistItem_key_unica_no_passo"
    ON "StepChecklistItem"("stepId", "key") WHERE "subtaskId" IS NULL;
CREATE UNIQUE INDEX "StepChecklistItem_key_unica_na_subtarefa"
    ON "StepChecklistItem"("subtaskId", "key") WHERE "subtaskId" IS NOT NULL;

-- ── REQUISITOS ──────────────────────────────────────────────────────────────
DROP INDEX IF EXISTS "StepRequirement_stepId_key_key";
CREATE UNIQUE INDEX "StepRequirement_key_unica_no_passo"
    ON "StepRequirement"("stepId", "key") WHERE "subtaskId" IS NULL;
CREATE UNIQUE INDEX "StepRequirement_key_unica_na_subtarefa"
    ON "StepRequirement"("subtaskId", "key") WHERE "subtaskId" IS NOT NULL;
