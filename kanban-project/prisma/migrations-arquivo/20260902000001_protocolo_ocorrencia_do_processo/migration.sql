-- PROTOCOLO É OCORRÊNCIA, NÃO CADASTRO (02/08/2026).
--
-- 1) Elimina o cadastro mestre "Tipos de Protocolo" (Gerenciamento › Documentos
--    e Protocolos). Nenhuma outra tabela referenciava "TipoProtocoloCadastro".
-- 2) Enriquece a protocolização DENTRO do processo com os campos mínimos:
--    órgão, setor, data/hora, número, tipo, forma de envio, responsável,
--    comprovante (anexos, já existentes), observações e documentos enviados.
--
-- Tudo idempotente. Aditivo, exceto o DROP do cadastro eliminado e o relaxamento
-- de NOT NULL em "Protocolo"."consulado" (legado da Espanha) — nenhum dado é
-- apagado nem convertido.

-- ── 1) cadastro eliminado ───────────────────────────────────────────────────
DROP TABLE IF EXISTS "TipoProtocoloCadastro";

-- ── 2) dimensões fechadas de domínio ────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE "TipoProtocolo" AS ENUM ('CONSULAR', 'JUDICIAL', 'ADMINISTRATIVO', 'COMUNE', 'CARTORIO', 'TRIBUNAL', 'OUTRO');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "FormaEnvioProtocolo" AS ENUM ('PRESENCIAL', 'CORREIO', 'EMAIL', 'PORTAL_ONLINE', 'TERCEIRO');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Timeline: a protocolização gera um Evento próprio do processo.
ALTER TYPE "TipoEvento" ADD VALUE IF NOT EXISTS 'PROTOCOLO';

-- ── 3) protocolização enriquecida ───────────────────────────────────────────
ALTER TABLE "Protocolo" ALTER COLUMN "consulado" DROP NOT NULL;
ALTER TABLE "Protocolo" ADD COLUMN IF NOT EXISTS "orgaoId" INTEGER;
ALTER TABLE "Protocolo" ADD COLUMN IF NOT EXISTS "setor" VARCHAR(120);
ALTER TABLE "Protocolo" ADD COLUMN IF NOT EXISTS "tipoProtocolo" "TipoProtocolo";
ALTER TABLE "Protocolo" ADD COLUMN IF NOT EXISTS "formaEnvio" "FormaEnvioProtocolo";
ALTER TABLE "Protocolo" ADD COLUMN IF NOT EXISTS "responsavelId" INTEGER;

CREATE INDEX IF NOT EXISTS "Protocolo_orgaoId_idx" ON "Protocolo"("orgaoId");
CREATE INDEX IF NOT EXISTS "Protocolo_responsavelId_idx" ON "Protocolo"("responsavelId");

ALTER TABLE "Protocolo" DROP CONSTRAINT IF EXISTS "Protocolo_orgaoId_fkey";
ALTER TABLE "Protocolo" ADD CONSTRAINT "Protocolo_orgaoId_fkey" FOREIGN KEY ("orgaoId") REFERENCES "OrgaoProtocolo"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Protocolo" DROP CONSTRAINT IF EXISTS "Protocolo_responsavelId_fkey";
ALTER TABLE "Protocolo" ADD CONSTRAINT "Protocolo_responsavelId_fkey" FOREIGN KEY ("responsavelId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ── 4) documentos enviados na protocolização ────────────────────────────────
CREATE TABLE IF NOT EXISTS "ProtocoloDocumento" (
  "id" SERIAL PRIMARY KEY,
  "protocoloId" INTEGER NOT NULL,
  "documentoId" INTEGER NOT NULL,
  "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "ProtocoloDocumento_protocoloId_documentoId_key" ON "ProtocoloDocumento"("protocoloId", "documentoId");
CREATE INDEX IF NOT EXISTS "ProtocoloDocumento_documentoId_idx" ON "ProtocoloDocumento"("documentoId");

ALTER TABLE "ProtocoloDocumento" DROP CONSTRAINT IF EXISTS "ProtocoloDocumento_protocoloId_fkey";
ALTER TABLE "ProtocoloDocumento" ADD CONSTRAINT "ProtocoloDocumento_protocoloId_fkey" FOREIGN KEY ("protocoloId") REFERENCES "Protocolo"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProtocoloDocumento" DROP CONSTRAINT IF EXISTS "ProtocoloDocumento_documentoId_fkey";
ALTER TABLE "ProtocoloDocumento" ADD CONSTRAINT "ProtocoloDocumento_documentoId_fkey" FOREIGN KEY ("documentoId") REFERENCES "Documento"("id") ON DELETE CASCADE ON UPDATE CASCADE;
