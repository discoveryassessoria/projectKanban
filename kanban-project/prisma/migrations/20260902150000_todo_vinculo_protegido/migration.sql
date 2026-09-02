-- TODA COLUNA DE VÍNCULO PASSA A SER PROTEGIDA PELO BANCO.
--
-- 35 colunas `<algo>Id` existiam sem chave estrangeira. Sem constraint o banco
-- não cascateia nem recusa, e apagar um registro deixa filhos apontando para o
-- vazio — foi assim que nasceram as 61 famílias, os 174 eventos de workflow e
-- as 11 obrigações econômicas órfãs já limpas.
--
-- Duas regras, e a diferença importa:
--
--   CASCADE   para TRILHA E POSSE (processo, árvore, documento, solicitação,
--             necessidade, protocolo, união, tarefa, família): o filho só
--             existia por causa do pai, então morre com ele.
--
--   SET NULL  para REFERÊNCIA a cadastro ou pessoa (usuário, responsável, item
--             do catálogo, tipo de processo, país, modalidade, fornecedor):
--             apagar o usuário não pode apagar o trabalho dele. Perde-se o
--             vínculo, não o registro.
--
--   RESTRICT  onde a coluna é NOT NULL e não aceita SET NULL: a exclusão do pai
--             é recusada, em vez de deixar filho inválido.
--
-- Antes das constraints: as 4 linhas órfãs remanescentes saem
-- (PhaseInternalWorkflow e PhaseInternalWorkflowVersao apontando para tipos de
-- processo deletados). Constraint sobre tabela suja não nasce.

DELETE FROM "PhaseInternalWorkflowVersao" x
 WHERE x."tipoProcessoId" IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM "TipoProcessoNacionalidade" p WHERE p.id = x."tipoProcessoId");

DELETE FROM "PhaseInternalWorkflow" x
 WHERE x."tipoProcessoId" IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM "TipoProcessoNacionalidade" p WHERE p.id = x."tipoProcessoId");

ALTER TABLE "AssistenteParametrizacaoProgresso" ADD CONSTRAINT "AssistenteParametrizacaoProgresso_tipoProcessoId_fkey" FOREIGN KEY ("tipoProcessoId") REFERENCES "TipoProcessoNacionalidade"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AssistenteParametrizacaoProgresso" ADD CONSTRAINT "AssistenteParametrizacaoProgresso_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CreditoFinanceiro" ADD CONSTRAINT "CreditoFinanceiro_pessoaId_fkey" FOREIGN KEY ("pessoaId") REFERENCES "Pessoa"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CreditoMovimento" ADD CONSTRAINT "CreditoMovimento_pessoaId_fkey" FOREIGN KEY ("pessoaId") REFERENCES "Pessoa"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CreditoMovimento" ADD CONSTRAINT "CreditoMovimento_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Divergencia" ADD CONSTRAINT "Divergencia_documentoId_fkey" FOREIGN KEY ("documentoId") REFERENCES "Documento"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Divergencia" ADD CONSTRAINT "Divergencia_pessoaId_fkey" FOREIGN KEY ("pessoaId") REFERENCES "Pessoa"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "DocumentoObservacao" ADD CONSTRAINT "DocumentoObservacao_solicitacaoId_fkey" FOREIGN KEY ("solicitacaoId") REFERENCES "SolicitacaoDocumento"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EmissaoRetificada" ADD CONSTRAINT "EmissaoRetificada_documentoId_fkey" FOREIGN KEY ("documentoId") REFERENCES "Documento"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MatrizDocumental" ADD CONSTRAINT "MatrizDocumental_tipoProcessoId_fkey" FOREIGN KEY ("tipoProcessoId") REFERENCES "TipoProcessoNacionalidade"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MotorArtefato" ADD CONSTRAINT "MotorArtefato_tipoProcessoId_fkey" FOREIGN KEY ("tipoProcessoId") REFERENCES "TipoProcessoNacionalidade"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "NecessidadeDocumental" ADD CONSTRAINT "NecessidadeDocumental_arvoreId_fkey" FOREIGN KEY ("arvoreId") REFERENCES "Arvore"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ObrigacaoEconomica" ADD CONSTRAINT "ObrigacaoEconomica_documentoId_fkey" FOREIGN KEY ("documentoId") REFERENCES "Documento"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ObrigacaoEconomica" ADD CONSTRAINT "ObrigacaoEconomica_itemCatalogoId_fkey" FOREIGN KEY ("itemCatalogoId") REFERENCES "ItemCatalogo"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "OperacaoAntecipada" ADD CONSTRAINT "OperacaoAntecipada_necessidadeId_fkey" FOREIGN KEY ("necessidadeId") REFERENCES "NecessidadeDocumental"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OperacaoAntecipada" ADD CONSTRAINT "OperacaoAntecipada_responsavelId_fkey" FOREIGN KEY ("responsavelId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Pagador" ADD CONSTRAINT "Pagador_pessoaId_fkey" FOREIGN KEY ("pessoaId") REFERENCES "Pessoa"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ParticipacaoEconomica" ADD CONSTRAINT "ParticipacaoEconomica_pessoaId_fkey" FOREIGN KEY ("pessoaId") REFERENCES "Pessoa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PastaApostilamentoDocumento" ADD CONSTRAINT "PastaApostilamentoDocumento_documentoId_fkey" FOREIGN KEY ("documentoId") REFERENCES "Documento"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PastaTraducaoDocumento" ADD CONSTRAINT "PastaTraducaoDocumento_documentoId_fkey" FOREIGN KEY ("documentoId") REFERENCES "Documento"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PendenciaFinanceira" ADD CONSTRAINT "PendenciaFinanceira_tipoProcessoId_fkey" FOREIGN KEY ("tipoProcessoId") REFERENCES "TipoProcessoNacionalidade"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PhaseAutomationRule" ADD CONSTRAINT "PhaseAutomationRule_tipoProcessoId_fkey" FOREIGN KEY ("tipoProcessoId") REFERENCES "TipoProcessoNacionalidade"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PhaseEconomicRule" ADD CONSTRAINT "PhaseEconomicRule_tipoProcessoId_fkey" FOREIGN KEY ("tipoProcessoId") REFERENCES "TipoProcessoNacionalidade"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PhaseInternalWorkflow" ADD CONSTRAINT "PhaseInternalWorkflow_tipoProcessoId_fkey" FOREIGN KEY ("tipoProcessoId") REFERENCES "TipoProcessoNacionalidade"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PhaseInternalWorkflowVersao" ADD CONSTRAINT "PhaseInternalWorkflowVersao_tipoProcessoId_fkey" FOREIGN KEY ("tipoProcessoId") REFERENCES "TipoProcessoNacionalidade"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PhaseWorkflowStepInstance" ADD CONSTRAINT "PhaseWorkflowStepInstance_responsavelId_fkey" FOREIGN KEY ("responsavelId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "RegraTarefaTransversal" ADD CONSTRAINT "RegraTarefaTransversal_tipoProcessoId_fkey" FOREIGN KEY ("tipoProcessoId") REFERENCES "TipoProcessoNacionalidade"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SaudeAchado" ADD CONSTRAINT "SaudeAchado_responsavelId_fkey" FOREIGN KEY ("responsavelId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SnapshotCambial" ADD CONSTRAINT "SnapshotCambial_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SolicitacaoDocumento" ADD CONSTRAINT "SolicitacaoDocumento_pessoaId_fkey" FOREIGN KEY ("pessoaId") REFERENCES "Pessoa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SolicitacaoDocumento" ADD CONSTRAINT "SolicitacaoDocumento_tarefaId_fkey" FOREIGN KEY ("tarefaId") REFERENCES "Tarefa"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StepSubtaskDefinition" ADD CONSTRAINT "StepSubtaskDefinition_responsavelId_fkey" FOREIGN KEY ("responsavelId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SubtaskExecution" ADD CONSTRAINT "SubtaskExecution_responsavelId_fkey" FOREIGN KEY ("responsavelId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Tarefa" ADD CONSTRAINT "Tarefa_pessoaId_fkey" FOREIGN KEY ("pessoaId") REFERENCES "Pessoa"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "WorkflowEvento" ADD CONSTRAINT "WorkflowEvento_tarefaId_fkey" FOREIGN KEY ("tarefaId") REFERENCES "Tarefa"("id") ON DELETE CASCADE ON UPDATE CASCADE;
