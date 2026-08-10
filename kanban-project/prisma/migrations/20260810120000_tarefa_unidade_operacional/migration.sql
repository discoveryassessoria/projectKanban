-- A TAREFA É A UNIDADE OPERACIONAL: uma obrigação real = uma Tarefa = um
-- workflow interno = N etapas.
--
-- O índice ÚNICO em `workflowInstanceId` é a trava estrutural: com uma
-- instância por tarefa, não existe caminho em que sete passos virem sete
-- tarefas. `workflowStepInstanceId` continua existindo, mas como PROJEÇÃO da
-- etapa corrente — ela muda sete vezes e a tarefa continua a mesma.
--
-- Seguro por construção: a base tem ZERO tarefas hoje (medido em 10/08/2026),
-- então o índice não pode conflitar com nada. Ainda assim ele é criado como
-- índice parcial em `NOT NULL` — tarefa administrativa, sem workflow, continua
-- possível e várias delas convivem.
ALTER TABLE "Tarefa"
  ADD COLUMN IF NOT EXISTS "equipeKey" VARCHAR(80),
  ADD COLUMN IF NOT EXISTS "dataAtribuicao" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "atribuidoPorId" INTEGER;

CREATE UNIQUE INDEX IF NOT EXISTS "Tarefa_workflowInstanceId_key"
  ON "Tarefa"("workflowInstanceId") WHERE "workflowInstanceId" IS NOT NULL;

-- Fila por equipe e "minha fila" por responsável: as duas leituras que a
-- operação faz o dia inteiro.
CREATE INDEX IF NOT EXISTS "Tarefa_equipeKey_statusTarefa_idx"
  ON "Tarefa"("equipeKey", "statusTarefa");
CREATE INDEX IF NOT EXISTS "Tarefa_responsavelId_statusTarefa_idx"
  ON "Tarefa"("responsavelId", "statusTarefa");
