-- ============================================================================
-- TIPO DE PROTOCOLO VIRA CADASTRO
-- ----------------------------------------------------------------------------
-- ADITIVA. O enum `TipoProtocolo` e a coluna `Protocolo.tipoProtocolo`
-- permanecem; saem na migration de remoção, depois que o código parar de lê-los.
--
-- POR QUÊ: o enum tinha 7 valores fixos no schema — classificar um ato novo
-- exigia deploy, e não havia descrição, ordem nem inativação. A regra
-- "protocolo NÃO é cadastro" continua valendo: o ATO segue sendo ocorrência
-- dentro do processo. O que virou cadastro é a CLASSIFICAÇÃO dele.
-- ============================================================================

CREATE TABLE IF NOT EXISTS "TipoProtocoloCadastro" (
    "id" SERIAL NOT NULL,
    "code" VARCHAR(60) NOT NULL,
    "nome" VARCHAR(120) NOT NULL,
    "descricao" TEXT,
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "TipoProtocoloCadastro_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "TipoProtocoloCadastro_code_key" ON "TipoProtocoloCadastro"("code");
CREATE INDEX IF NOT EXISTS "TipoProtocoloCadastro_ativo_idx" ON "TipoProtocoloCadastro"("ativo");

ALTER TABLE "Protocolo" ADD COLUMN IF NOT EXISTS "tipoProtocoloId" INTEGER;
CREATE INDEX IF NOT EXISTS "Protocolo_tipoProtocoloId_idx" ON "Protocolo"("tipoProtocoloId");

DO $$ BEGIN
  ALTER TABLE "Protocolo" ADD CONSTRAINT "Protocolo_tipoProtocoloId_fkey"
    FOREIGN KEY ("tipoProtocoloId") REFERENCES "TipoProtocoloCadastro"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
