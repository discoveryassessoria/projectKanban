-- ELIMINAÇÃO DO "TERCEIRO RELÓGIO" DE SLA (FaseMacro/CatalogoFase) — decisão
-- do usuário, 17/09/2026: Fase Macro e Processo não têm prazo. O prazo
-- canônico vive só em Tarefa (macro da entrega) e Subtarefa (execução) — ver
-- lib/operacional/tempo-operacional.ts e a memória
-- prazo-tarefa-subtarefa-dois-relogios. A Árvore Genealógica também não tem
-- prazo/SLA: era o único consumidor legítimo restante da engine removida
-- (src/lib/motor/sla-core.ts, src/lib/process-stage/sla-projection.ts,
-- src/types/sla.ts — deletados no mesmo commit).
--
-- Nenhum outro campo destas tabelas é tocado. Passo/Subtarefa mantêm seu
-- próprio slaDays (PhaseInternalWorkflowStep, PhaseWorkflowStepInstance) —
-- essa é a fonte real dos dois relógios oficiais, intocada aqui.

ALTER TABLE "FaseMacro" DROP COLUMN IF EXISTS "slaDays";
ALTER TABLE "CatalogoFase" DROP COLUMN IF EXISTS "slaDiasPadrao";
