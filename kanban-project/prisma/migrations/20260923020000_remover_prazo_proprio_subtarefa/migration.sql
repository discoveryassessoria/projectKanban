-- Remove o relógio de execução próprio da subtarefa (decisão definitiva,
-- 23/09/2026): existe um único prazo final por Tarefa. Fases e subtarefas
-- não têm vencimento próprio. Acompanhamentos de terceiros (StepSubtaskDefinition.
-- acompanhamentoAtivo/acompanhamentoPrimeiroDias/regraTemporalAtiva/regraTemporalDias/
-- regraTemporalGatilhoChave, SubtaskExecution.previstoPara/proximoAcompanhamentoEm)
-- permanecem intocados — são lembretes de retorno de terceiro, nunca um
-- segundo vencimento da tarefa.
--
-- Verificado antes de remover (produção, 23/09/2026): 1 linha em
-- StepSubtaskDefinition.slaDays (debris sintético de teste visual, workflow
-- "TESTEVIS_fase", tipoProcessoId nulo — não é configuração real), 0 linhas
-- em SubtaskExecution.prazo. Nenhum dado real de negócio existia nesses
-- campos — nada a migrar, nada a reconciliar.

ALTER TABLE "StepSubtaskDefinition" DROP COLUMN "slaDays";
ALTER TABLE "SubtaskExecution" DROP COLUMN "prazo";
