-- MODALIDADE LEGAL e ENQUADRAMENTO LEGAL — duas dimensões que faltavam.
--
-- Hoje o sistema tem TIPO DE PROCESSO (país + produto) e ModalidadePais, que na
-- prática nomeia VIA DE TRAMITAÇÃO (administrativa/judicial). Faltava a base
-- jurídica sob a qual a nacionalidade é requerida — e o recorte oficial dentro
-- dela, que é o que determina conjunto documental.
--
-- ADITIVA e REVERSÍVEL: só cria. Nenhuma coluna existente é alterada, nenhum
-- registro é tocado, e `ModalidadePais` fica exatamente como está — corrigir a
-- semântica dela exige mapear seus 122 consumidores, e isso é outro trabalho.
--
-- O vínculo do processo é UMA FK: o enquadramento implica a modalidade legal e,
-- por ela, o país. Sem campo redundante que possa divergir do resto.

CREATE TABLE IF NOT EXISTS "ModalidadeLegal" (
    "id" SERIAL NOT NULL,
    "code" VARCHAR(60) NOT NULL,
    "nome" VARCHAR(200) NOT NULL,
    "descricao" TEXT,
    "paisId" INTEGER NOT NULL,
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ModalidadeLegal_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "ModalidadeLegal_code_key" ON "ModalidadeLegal"("code");
CREATE INDEX IF NOT EXISTS "ModalidadeLegal_paisId_idx" ON "ModalidadeLegal"("paisId");

DO $$ BEGIN
    ALTER TABLE "ModalidadeLegal" ADD CONSTRAINT "ModalidadeLegal_paisId_fkey"
        FOREIGN KEY ("paisId") REFERENCES "CatalogoPais"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "EnquadramentoLegal" (
    "id" SERIAL NOT NULL,
    "code" VARCHAR(60) NOT NULL,
    "nome" VARCHAR(200) NOT NULL,
    "descricao" TEXT,
    "modalidadeLegalId" INTEGER NOT NULL,
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EnquadramentoLegal_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "EnquadramentoLegal_code_key" ON "EnquadramentoLegal"("code");
CREATE INDEX IF NOT EXISTS "EnquadramentoLegal_modalidadeLegalId_idx" ON "EnquadramentoLegal"("modalidadeLegalId");

DO $$ BEGIN
    ALTER TABLE "EnquadramentoLegal" ADD CONSTRAINT "EnquadramentoLegal_modalidadeLegalId_fkey"
        FOREIGN KEY ("modalidadeLegalId") REFERENCES "ModalidadeLegal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "Processo" ADD COLUMN IF NOT EXISTS "enquadramentoLegalId" INTEGER;
CREATE INDEX IF NOT EXISTS "Processo_enquadramentoLegalId_idx" ON "Processo"("enquadramentoLegalId");

DO $$ BEGIN
    ALTER TABLE "Processo" ADD CONSTRAINT "Processo_enquadramentoLegalId_fkey"
        FOREIGN KEY ("enquadramentoLegalId") REFERENCES "EnquadramentoLegal"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
