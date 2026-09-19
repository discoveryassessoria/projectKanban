-- SINO — MOTIVOS CONSOLIDADOS (mandato "consolidação do sino", 19/09/2026).
--
-- Uma mesma Tarefa não pode gerar mais de uma notificação quando prazo
-- oficial, acompanhamento e regra temporal do terceiro vencem juntos. `tipo`
-- continua sendo o rótulo principal (compatibilidade com quem já lê `tipo`,
-- ex. Saúde do Sistema); `motivos` guarda a lista completa de MotivoAtencao
-- ativos naquele instante, para a notificação consolidada nunca perder fato.
--
-- Aditivo, nullable, 100% retrocompatível: notificações existentes e as que
-- não passam por este caminho (ATRIBUICAO, TRANSFERENCIA, RETORNO_TERCEIRO,
-- FASE_CONCLUIDA) continuam com `motivos = null`, nunca inventado.
ALTER TABLE "NotificacaoOperacional"
  ADD COLUMN IF NOT EXISTS "motivos" JSONB;
