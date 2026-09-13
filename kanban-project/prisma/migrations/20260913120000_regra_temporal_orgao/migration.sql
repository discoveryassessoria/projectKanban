-- Mandato Emissão Documental — Bloco 2: regra temporal por cartório/terceiro.
--
-- RegraTemporalOrgao — "o cartório X é sabidamente mais rápido/lento que a
-- média, neste passo": mesmo padrão de identidade de ExigenciaEvidenciaEtapa
-- (stepKey lógico, não FK forte a uma linha de PhaseInternalWorkflowStep que
-- pode ser recriada). Ver lib/operacional/sla-por-orgao.ts.
--
-- ADITIVA e IDEMPOTENTE: só cria tabela, índices e chave estrangeira novos.
-- Nenhuma linha existente é alterada ou removida, nenhuma coluna é dropada,
-- nenhum comportamento atual muda. Reexecutar é seguro.
--
-- ROLLBACK (sem perda de dado pré-existente — tudo aqui é novo):
--   DROP TABLE "RegraTemporalOrgao";

CREATE TABLE IF NOT EXISTS "RegraTemporalOrgao" (
    "id" SERIAL NOT NULL,
    "stepKey" VARCHAR(80) NOT NULL,
    "orgaoProtocoloId" INTEGER NOT NULL,
    "slaDays" INTEGER NOT NULL,
    "followUpDays" INTEGER,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "chaveRegra" VARCHAR(140) NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "RegraTemporalOrgao_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "RegraTemporalOrgao_chaveRegra_key" ON "RegraTemporalOrgao"("chaveRegra");
CREATE INDEX IF NOT EXISTS "RegraTemporalOrgao_stepKey_idx" ON "RegraTemporalOrgao"("stepKey");
CREATE INDEX IF NOT EXISTS "RegraTemporalOrgao_orgaoProtocoloId_idx" ON "RegraTemporalOrgao"("orgaoProtocoloId");

DO $$ BEGIN
  ALTER TABLE "RegraTemporalOrgao" ADD CONSTRAINT "RegraTemporalOrgao_orgaoProtocoloId_fkey"
    FOREIGN KEY ("orgaoProtocoloId") REFERENCES "OrgaoProtocolo"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
