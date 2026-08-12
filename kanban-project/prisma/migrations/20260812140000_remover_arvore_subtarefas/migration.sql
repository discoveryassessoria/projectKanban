-- Remove a árvore de subtarefas (tarefa-pai → tarefa-filha) do modelo de Tarefa.
--
-- A arquitetura do motor operacional é TAREFA → WORKFLOW → PASSOS. O
-- desdobramento do trabalho acontece nos passos publicados do workflow, nunca
-- em tarefas-filhas. A coluna `tarefaPaiId` e o discriminador `tipoSubtarefa`
-- pertenciam a um desenho anterior, já sem escritor de runtime, sem leitor
-- operacional e sem nenhuma linha em produção.
--
-- Esta migration NÃO apaga Tarefas. Ela remove uma FK auto-referente, o índice
-- que a servia e duas colunas. Nenhuma linha é deletada: o ON DELETE CASCADE
-- da FK só teria efeito ao apagar uma tarefa-pai, e não há nenhuma relação
-- pai/filho registrada. `DROP CONSTRAINT` desfaz a regra de cascata ANTES de
-- qualquer outra coisa, de modo que nenhuma etapa posterior possa propagar.

ALTER TABLE "Tarefa" DROP CONSTRAINT IF EXISTS "Tarefa_tarefaPaiId_fkey";
DROP INDEX IF EXISTS "Tarefa_tarefaPaiId_idx";
ALTER TABLE "Tarefa" DROP COLUMN IF EXISTS "tarefaPaiId";
ALTER TABLE "Tarefa" DROP COLUMN IF EXISTS "tipoSubtarefa";
