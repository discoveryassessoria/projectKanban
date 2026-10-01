-- TORRE NOVA (M2) — PAUSA DE PROCESSO. APPEND-ONLY.
--
-- Pausar abre uma linha; reativar a FECHA (`retomadoEm`). Nada é apagado: o histórico de
-- pausas fica. No máximo UMA pausa vigente por processo (índice parcial único). Efeito: o
-- processo pausado sai das contagens/lista/Radar da Torre; a Operação não muda; o prazo de
-- tarefa não pausa por isso.
--
-- ADITIVA e IDEMPOTENTE: tabela nova.

CREATE TABLE IF NOT EXISTS "ProcessoPausa" (
    "id" SERIAL NOT NULL,
    "processoId" INTEGER NOT NULL,
    "pausadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "pausadoPorId" INTEGER,
    "motivo" VARCHAR(300) NOT NULL,
    "retomadoEm" TIMESTAMP(3),
    "retomadoPorId" INTEGER,
    CONSTRAINT "ProcessoPausa_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ProcessoPausa_processoId_pausadoEm_idx" ON "ProcessoPausa"("processoId", "pausadoEm");
-- No máximo uma pausa VIGENTE por processo (padrão de SubtaskExecution vigente).
CREATE UNIQUE INDEX IF NOT EXISTS "ProcessoPausa_vigente_key" ON "ProcessoPausa"("processoId") WHERE "retomadoEm" IS NULL;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ProcessoPausa_processoId_fkey') THEN
    ALTER TABLE "ProcessoPausa" ADD CONSTRAINT "ProcessoPausa_processoId_fkey"
      FOREIGN KEY ("processoId") REFERENCES "Processo"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ProcessoPausa_pausadoPorId_fkey') THEN
    ALTER TABLE "ProcessoPausa" ADD CONSTRAINT "ProcessoPausa_pausadoPorId_fkey"
      FOREIGN KEY ("pausadoPorId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ProcessoPausa_retomadoPorId_fkey') THEN
    ALTER TABLE "ProcessoPausa" ADD CONSTRAINT "ProcessoPausa_retomadoPorId_fkey"
      FOREIGN KEY ("retomadoPorId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ProcessoPausa_motivo_nao_vazio') THEN
    ALTER TABLE "ProcessoPausa" ADD CONSTRAINT "ProcessoPausa_motivo_nao_vazio" CHECK (length(btrim("motivo")) >= 5);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ProcessoPausa_retomada_depois_da_pausa') THEN
    ALTER TABLE "ProcessoPausa" ADD CONSTRAINT "ProcessoPausa_retomada_depois_da_pausa" CHECK ("retomadoEm" IS NULL OR "retomadoEm" >= "pausadoEm");
  END IF;
END $$;
