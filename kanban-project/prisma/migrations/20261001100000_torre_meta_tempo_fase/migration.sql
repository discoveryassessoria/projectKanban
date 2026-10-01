-- TORRE NOVA (M1) — META DE TEMPO POR FASE (e por país). SOMENTE EXIBIÇÃO.
--
-- "Tempo médio real × meta" e a cor do funil da Visão geral. NÃO é SLA, NÃO gera prazo, NÃO
-- alimenta atraso/score/notificação (o SLA de fase foi ELIMINADO em 17/09/2026 e continua
-- eliminado). `phaseKey` é chave solta (mesmo padrão de FaseMacro.phaseKey), validada contra o
-- CatalogoFase na porta — sem FK, porque o Catálogo de Fases é módulo fechado.
--
-- ADITIVA e IDEMPOTENTE: tabela nova; nada existente é lido, alterado ou removido.

CREATE TABLE IF NOT EXISTS "MetaTempoFase" (
    "id" SERIAL NOT NULL,
    "phaseKey" VARCHAR(60) NOT NULL,
    "paisId" INTEGER,
    "metaDias" INTEGER NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "atualizadoPorId" INTEGER,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "MetaTempoFase_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "MetaTempoFase_phaseKey_paisId_key" ON "MetaTempoFase"("phaseKey", "paisId");
CREATE INDEX IF NOT EXISTS "MetaTempoFase_phaseKey_idx" ON "MetaTempoFase"("phaseKey");
-- A meta PADRÃO da fase (sem país) é única: NULL não colide em UNIQUE comum, então o índice parcial fecha o buraco.
CREATE UNIQUE INDEX IF NOT EXISTS "MetaTempoFase_phaseKey_padrao_key" ON "MetaTempoFase"("phaseKey") WHERE "paisId" IS NULL;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'MetaTempoFase_paisId_fkey') THEN
    ALTER TABLE "MetaTempoFase" ADD CONSTRAINT "MetaTempoFase_paisId_fkey"
      FOREIGN KEY ("paisId") REFERENCES "CatalogoPais"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'MetaTempoFase_atualizadoPorId_fkey') THEN
    ALTER TABLE "MetaTempoFase" ADD CONSTRAINT "MetaTempoFase_atualizadoPorId_fkey"
      FOREIGN KEY ("atualizadoPorId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'MetaTempoFase_metaDias_positiva') THEN
    ALTER TABLE "MetaTempoFase" ADD CONSTRAINT "MetaTempoFase_metaDias_positiva" CHECK ("metaDias" > 0);
  END IF;
END $$;
