-- REGULARIZAÇÃO HISTÓRICA — cadastro de processo já em fase avançada.
--
-- Um processo que chega ao Discovery já em Retificação não pode ser obrigado a
-- começar na primeira fase, nem ter o histórico marcado como concluído sem que o
-- trabalho tenha sido registrado. As fases anteriores passam a existir com estado
-- próprio (PENDENTE_DE_REGULARIZACAO), e a data REAL informada retroativamente vive
-- em coluna separada da data de registro — nenhuma data de sistema é reescrita.
--
-- ADITIVO e IDEMPOTENTE: só adiciona valores de enum, colunas nullable e defaults
-- que preservam o comportamento atual. Nenhum dado existente é lido ou alterado.

-- Estados novos da instância de fase.
ALTER TYPE "WorkflowInstanceStatus" ADD VALUE IF NOT EXISTS 'PENDENTE_DE_REGULARIZACAO';
ALTER TYPE "WorkflowInstanceStatus" ADD VALUE IF NOT EXISTS 'NAO_APLICAVEL';

-- Integridade histórica do processo (indicador; não encerra nem bloqueia a operação).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'RegularizacaoHistorica') THEN
    CREATE TYPE "RegularizacaoHistorica" AS ENUM ('NAO_NECESSARIA', 'PENDENTE', 'PARCIAL', 'REGULARIZADA');
  END IF;
END $$;

ALTER TABLE "PhaseWorkflowInstance"
  ADD COLUMN IF NOT EXISTS "inicioReal" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "conclusaoReal" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "fonteDataHistorica" VARCHAR(200),
  ADD COLUMN IF NOT EXISTS "requerRegularizacao" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "regularizadoEm" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "regularizadoPorId" INTEGER,
  ADD COLUMN IF NOT EXISTS "motivoAdministrativo" TEXT,
  ADD COLUMN IF NOT EXISTS "motivoNaoAplicavel" TEXT,
  ADD COLUMN IF NOT EXISTS "criadoPorId" INTEGER;

ALTER TABLE "Processo"
  ADD COLUMN IF NOT EXISTS "regularizacaoHistorica" "RegularizacaoHistorica" NOT NULL DEFAULT 'NAO_NECESSARIA',
  ADD COLUMN IF NOT EXISTS "regularizacaoConcluidaEm" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "regularizacaoConcluidaPorId" INTEGER,
  ADD COLUMN IF NOT EXISTS "motivoCadastroEmAndamento" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PhaseWorkflowInstance_regularizadoPorId_fkey') THEN
    ALTER TABLE "PhaseWorkflowInstance" ADD CONSTRAINT "PhaseWorkflowInstance_regularizadoPorId_fkey"
      FOREIGN KEY ("regularizadoPorId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PhaseWorkflowInstance_criadoPorId_fkey') THEN
    ALTER TABLE "PhaseWorkflowInstance" ADD CONSTRAINT "PhaseWorkflowInstance_criadoPorId_fkey"
      FOREIGN KEY ("criadoPorId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Processo_regularizacaoConcluidaPorId_fkey') THEN
    ALTER TABLE "Processo" ADD CONSTRAINT "Processo_regularizacaoConcluidaPorId_fkey"
      FOREIGN KEY ("regularizacaoConcluidaPorId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "PhaseWorkflowInstance_processoId_requerRegularizacao_idx"
  ON "PhaseWorkflowInstance"("processoId", "requerRegularizacao");
