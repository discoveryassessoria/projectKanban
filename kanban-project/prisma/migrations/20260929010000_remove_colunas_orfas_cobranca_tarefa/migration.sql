-- Colunas órfãs do bloco antigo de cobrança em Tarefa. Confirmado por busca em
-- src/, lib/ e scripts/ (excluindo testes): zero escritas e zero leituras em
-- todo o código-fonte. A régua real de cobrança/escalada migrou para
-- PhaseInternalWorkflowStep.diasAposCobranca/escalarApos + SubtaskExecution +
-- ContatoTerceiro (mandato 25/09/2026).
--
-- `quantidadeCobrancas` NÃO entra aqui: é lida por
-- src/lib/relatorios/motor/dominios/tarefas.ts (coluna "Cobranças" do
-- Relatório de Tarefas) — permanece até essa leitura ser decidida separadamente.
ALTER TABLE "Tarefa" DROP COLUMN IF EXISTS "prazoCobranca";
ALTER TABLE "Tarefa" DROP COLUMN IF EXISTS "ultimaCobranca";
