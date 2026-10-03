-- COLETA DE DADOS DO CLIENTE — link público por processo (pré-cadastro).
-- Mandato: docs/coleta-de-dados-mandato.md.
--
-- Três tabelas NOVAS (ColetaLink, ColetaEnvio, ColetaArquivo). Nada existente é alterado: sem coluna nova em
-- tabela antiga, sem backfill, sem DROP. O que o cliente envia NÃO é cadastro oficial: só vira
-- Requerente/Contratante na conferência (saída de "Aguardando fechamento"). Nenhuma Pessoa é criada.
--
-- ADITIVA e IDEMPOTENTE (IF NOT EXISTS; FKs em bloco guardado).

-- CreateTable
CREATE TABLE IF NOT EXISTS "ColetaLink" (
    "id" SERIAL NOT NULL,
    "codigo" VARCHAR(64) NOT NULL,
    "processoId" INTEGER NOT NULL,
    "criadoPorId" INTEGER,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "encerradoEm" TIMESTAMP(3),
    "motivoEncerramento" VARCHAR(20),
    "encerradoPorId" INTEGER,

    CONSTRAINT "ColetaLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "ColetaEnvio" (
    "id" SERIAL NOT NULL,
    "linkId" INTEGER NOT NULL,
    "cpf" VARCHAR(11),
    "dados" JSONB,
    "papel" VARCHAR(20) NOT NULL,
    "consentimentoEm" TIMESTAMP(3) NOT NULL,
    "consentimentoVersao" VARCHAR(20) NOT NULL,
    "ipHash" VARCHAR(64),
    "status" VARCHAR(12) NOT NULL DEFAULT 'PENDENTE',
    "reenvios" INTEGER NOT NULL DEFAULT 0,
    "reenviadoEm" TIMESTAMP(3),
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,
    "decididoEm" TIMESTAMP(3),
    "decididoPorId" INTEGER,
    "papelConfirmado" VARCHAR(20),
    "requerenteId" INTEGER,
    "contratanteId" INTEGER,
    "purgadoEm" TIMESTAMP(3),

    CONSTRAINT "ColetaEnvio_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "ColetaArquivo" (
    "id" SERIAL NOT NULL,
    "envioId" INTEGER NOT NULL,
    "tipo" VARCHAR(24) NOT NULL,
    "chave" VARCHAR(300) NOT NULL,
    "nome" VARCHAR(200) NOT NULL,
    "tamanho" INTEGER NOT NULL,
    "mime" VARCHAR(100) NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ColetaArquivo_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "ColetaLink_codigo_key" ON "ColetaLink"("codigo");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ColetaLink_processoId_idx" ON "ColetaLink"("processoId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ColetaEnvio_linkId_status_idx" ON "ColetaEnvio"("linkId", "status");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "ColetaEnvio_linkId_cpf_key" ON "ColetaEnvio"("linkId", "cpf");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "ColetaArquivo_chave_key" ON "ColetaArquivo"("chave");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ColetaArquivo_envioId_idx" ON "ColetaArquivo"("envioId");

-- AddForeignKey
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ColetaLink_processoId_fkey') THEN
    ALTER TABLE "ColetaLink" ADD CONSTRAINT "ColetaLink_processoId_fkey" FOREIGN KEY ("processoId") REFERENCES "Processo"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ColetaLink_criadoPorId_fkey') THEN
    ALTER TABLE "ColetaLink" ADD CONSTRAINT "ColetaLink_criadoPorId_fkey" FOREIGN KEY ("criadoPorId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ColetaEnvio_linkId_fkey') THEN
    ALTER TABLE "ColetaEnvio" ADD CONSTRAINT "ColetaEnvio_linkId_fkey" FOREIGN KEY ("linkId") REFERENCES "ColetaLink"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ColetaEnvio_decididoPorId_fkey') THEN
    ALTER TABLE "ColetaEnvio" ADD CONSTRAINT "ColetaEnvio_decididoPorId_fkey" FOREIGN KEY ("decididoPorId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ColetaEnvio_requerenteId_fkey') THEN
    ALTER TABLE "ColetaEnvio" ADD CONSTRAINT "ColetaEnvio_requerenteId_fkey" FOREIGN KEY ("requerenteId") REFERENCES "Requerente"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ColetaEnvio_contratanteId_fkey') THEN
    ALTER TABLE "ColetaEnvio" ADD CONSTRAINT "ColetaEnvio_contratanteId_fkey" FOREIGN KEY ("contratanteId") REFERENCES "Contratante"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ColetaArquivo_envioId_fkey') THEN
    ALTER TABLE "ColetaArquivo" ADD CONSTRAINT "ColetaArquivo_envioId_fkey" FOREIGN KEY ("envioId") REFERENCES "ColetaEnvio"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

