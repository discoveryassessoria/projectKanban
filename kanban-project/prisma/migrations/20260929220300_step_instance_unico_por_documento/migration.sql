-- Mandato "Correção do reconciliador NEC-001" (29/09/2026): dois materializadores
-- independentes (materializarGenealogia — chave `matdoc|...` — e
-- instanciarWorkflowDaFase/materializarAlvos — chave `wfi...`) podiam criar DOIS
-- PhaseWorkflowStepInstance ativos para a MESMA obrigação (mesmo workflowInstanceId
-- + stepKey + ciclo + documentoId), sem se reconhecerem. WF-100 (Saúde) já detectava
-- isso lendo o banco; esta é a trava física — fisicamente impossível uma SEGUNDA
-- linha não-terminal para a mesma obrigação, mesmo padrão de
-- PhaseWorkflowInstance_uma_ativa_por_fase (20260928200000).
--
-- Escopo: só documentoId NOT NULL (a chave que WF-100 e o materializador usam —
-- passos sem Documento ainda vinculado, comuns em Genealogia antes do Documento
-- nascer, não competem entre si por esta trava). Terminal = CANCELADO, SUPERSEDIDO,
-- DISPENSADO — os mesmos três estados que `passosOperacaoV2`/`montarWorkflowV2`
-- (INATIVOS) e a varredura WF-100 já tratam como "não conta".
--
-- Pré-condição verificada em produção antes desta migration: os 9 duplicados
-- conhecidos (processo 676/Salvarani, achado no diagnóstico deste mesmo mandato)
-- foram saneados manualmente, um documento por vez, com log e verificação real via
-- `montarWorkflowV2` — ver LogAuditoria PASSO_DUPLICADO_SUPERSEDIDO (9 registros,
-- 29/09/2026). Varredura final nos processos 651/675/676: 0 duplicados ativos.
CREATE UNIQUE INDEX "PhaseWorkflowStepInstance_unico_por_documento"
    ON "PhaseWorkflowStepInstance"("workflowInstanceId", "stepKey", "ciclo", "documentoId")
    WHERE "documentoId" IS NOT NULL AND "status" NOT IN ('CANCELADO', 'SUPERSEDIDO', 'DISPENSADO');
