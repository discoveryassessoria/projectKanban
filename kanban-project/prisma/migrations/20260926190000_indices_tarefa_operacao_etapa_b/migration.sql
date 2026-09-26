-- Etapa B (perf /api/operacao/tarefas, 26/09/2026): índices que faltavam
-- pro caminho mais quente do sistema — minhaFila/visaoGerencial sempre
-- filtram responsavelId+statusTarefa juntos e ordenam por dataPrazo.
CREATE INDEX "Tarefa_faseMacroKey_idx" ON "Tarefa"("faseMacroKey");
CREATE INDEX "Tarefa_responsavelId_statusTarefa_dataPrazo_idx" ON "Tarefa"("responsavelId", "statusTarefa", "dataPrazo");
