-- Prazo do passo POR PAÍS DO REGISTRO — cadastro (Gerenciamento), não código.
-- Ver lib/operacional/prazo-por-pais.ts. "Nasceu na Itália: 30 dias; casou e morreu no Brasil: 1 dia."
--
-- ADITIVA e IDEMPOTENTE: só cria tabela e índices novos e UMA linha de cadastro (Brasil = 1 dia no passo
-- «localizar_registro», por ordem do Marco em 08/10/2026). Nenhuma linha existente é alterada ou removida.
--
-- ROLLBACK (sem perda de dado pré-existente — tudo aqui é novo):
--   DROP TABLE "RegraTemporalPais";

CREATE TABLE IF NOT EXISTS "RegraTemporalPais" (
    "id" SERIAL NOT NULL,
    "stepKey" VARCHAR(80) NOT NULL,
    "paisChave" VARCHAR(80) NOT NULL,
    "paisNome" VARCHAR(120) NOT NULL,
    "slaDays" INTEGER NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "RegraTemporalPais_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "RegraTemporalPais_stepKey_paisChave_key" ON "RegraTemporalPais"("stepKey", "paisChave");
CREATE INDEX IF NOT EXISTS "RegraTemporalPais_stepKey_idx" ON "RegraTemporalPais"("stepKey");

INSERT INTO "RegraTemporalPais" ("stepKey", "paisChave", "paisNome", "slaDays", "ativo", "atualizadoEm")
VALUES ('localizar_registro', 'brasil', 'Brasil', 1, true, CURRENT_TIMESTAMP)
ON CONFLICT ("stepKey", "paisChave") DO NOTHING;
