-- Motor de fases: escopo e modo de execução passam a ser CONFIGURAÇÃO PERSISTIDA.
--
-- Antes, "quais passos existem" dependia de necessidade documental materializada e
-- "quando um passo fica disponível" era regra fixa no código. Estas três colunas
-- movem a decisão para o cadastro oficial do Workflow Interno da fase.
--
-- ADITIVO, IDEMPOTENTE e REVERSÍVEL: só adiciona colunas com DEFAULT que reproduz o
-- comportamento pretendido. Nenhum dado existente é lido, alterado ou apagado.

-- Modo de execução dos passos publicados da fase.
--   SEQUENCIAL = só o primeiro passo nasce DISPONIVEL; concluir um libera o seguinte.
--   PARALELO   = todos nascem DISPONIVEL.
ALTER TABLE "PhaseInternalWorkflow"
  ADD COLUMN IF NOT EXISTS "execucao" VARCHAR(20) NOT NULL DEFAULT 'SEQUENCIAL';

-- Escopo de execução de cada passo publicado.
--   GLOBAL    = 1 instância compartilhada por fase/ciclo do processo.
--   PESSOA    = 1 instância por pessoa aplicável.
--   DOCUMENTO = 1 instância por necessidade/documento aplicável.
ALTER TABLE "PhaseInternalWorkflowStep"
  ADD COLUMN IF NOT EXISTS "escopo" VARCHAR(20) NOT NULL DEFAULT 'GLOBAL';

-- Entidade do escopo na INSTÂNCIA do passo. documentoId/necessidadeId já existiam;
-- pessoaId completa o trio para o escopo PESSOA.
ALTER TABLE "PhaseWorkflowStepInstance"
  ADD COLUMN IF NOT EXISTS "pessoaId" INTEGER;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'PhaseWorkflowStepInstance_pessoaId_fkey'
  ) THEN
    ALTER TABLE "PhaseWorkflowStepInstance"
      ADD CONSTRAINT "PhaseWorkflowStepInstance_pessoaId_fkey"
      FOREIGN KEY ("pessoaId") REFERENCES "Pessoa"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "PhaseWorkflowStepInstance_pessoaId_idx"
  ON "PhaseWorkflowStepInstance"("pessoaId");
