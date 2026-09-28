-- PROC-005 (processo 651, 26-28/09/2026): duas PhaseWorkflowInstance ATIVO
-- simultâneas para a mesma (processoId, faseMacroKey) — um retrocesso manual
-- mintou um ciclo novo sem checar se a fase-destino já tinha uma instância
-- ativa parada. Corrigido na aplicação (cicloAlvoParaFase, phase-advance.ts),
-- mas uma checagem de aplicação sozinha pode ter condição de corrida ou ser
-- contornada por um caminho futuro que esqueça de chamá-la.
--
-- Esta é a trava física: fisicamente impossível existir uma SEGUNDA linha
-- ATIVO/BLOQUEADO/AGUARDANDO para a mesma fase do mesmo processo. Mesmo padrão
-- já usado em StepExecution_uma_vigente_por_passo (20260820140000).
--
-- Pré-condição verificada em produção antes desta migration: nenhuma linha
-- viola a constraint (a única violação existente — processo 651/genealogia —
-- foi reconciliada manualmente antes deste deploy; ver LogAuditoria
-- PROC005_REMEDIACAO_MANUAL).
CREATE UNIQUE INDEX "PhaseWorkflowInstance_uma_ativa_por_fase"
    ON "PhaseWorkflowInstance"("processoId", "faseMacroKey")
    WHERE "status" IN ('ATIVO', 'BLOQUEADO', 'AGUARDANDO');
