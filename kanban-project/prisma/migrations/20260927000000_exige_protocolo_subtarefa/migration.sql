-- Bug 2 (rodada de ajustes Operação v3, 26/09/2026): subtarefa marcada não
-- pode concluir sem protocolo/protocoloId — ver
-- concluirSubtarefaCorrentePeloPasso (subtarefas-da-etapa.ts).
ALTER TABLE "StepSubtaskDefinition" ADD COLUMN "exigeProtocolo" BOOLEAN NOT NULL DEFAULT false;
