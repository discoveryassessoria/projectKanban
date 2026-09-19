-- CONTROLE TEMPORAL DA ESPERA DE SUBTAREFA (mandato "correção definitiva do
-- modelo temporal", 19-20/09/2026) — dois relógios independentes de uma
-- espera de terceiro, nenhum dos dois é o prazo oficial da Tarefa
-- (Tarefa.dataPrazo, intocado) e nenhum reaproveita StepSubtaskDefinition.
-- slaDays (que continua sendo, exclusivamente, o SLA de ação interna).
--
-- ACOMPANHAMENTO — "quando esta espera volta à atenção". REGRA TEMPORAL —
-- "limite/expectativa temporal desta espera", com gatilho genérico
-- (conclusão de outra subtarefa do mesmo passo, ou a própria liberação).
--
-- Aditivo, idempotente, 100% retrocompatível: todo default é false/null —
-- nenhuma subtarefa já cadastrada ganha comportamento novo sem decisão
-- explícita do administrador em Gerenciamento.
ALTER TABLE "StepSubtaskDefinition"
  ADD COLUMN IF NOT EXISTS "acompanhamentoAtivo" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "acompanhamentoPrimeiroDias" INTEGER,
  ADD COLUMN IF NOT EXISTS "regraTemporalAtiva" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "regraTemporalDias" INTEGER,
  ADD COLUMN IF NOT EXISTS "regraTemporalGatilhoChave" VARCHAR(60);

-- MATERIALIZAÇÃO, por execução — proximoAcompanhamentoEm é campo novo;
-- previstoPara já existia (reaproveitado para a regra temporal, nunca uma
-- coluna duplicada para o mesmo conceito).
ALTER TABLE "SubtaskExecution"
  ADD COLUMN IF NOT EXISTS "proximoAcompanhamentoEm" TIMESTAMP(3);
