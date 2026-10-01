-- TORRE NOVA (M3) — APTIDÃO OPERACIONAL POR PAÍS ("apto em Itália").
--
-- Mesma semântica opt-in de AptidaoOperacional (por unidade de trabalho) e SOMA-SE a ela, nunca a
-- substitui: país sem nenhum apto declarado não restringe ninguém; com ao menos um, só os declarados
-- passam. Sem cadastro nenhum a Torre diz "sem aptidão cadastrada" e NUNCA atribui sem aptidão comprovada.
--
-- ADITIVA e IDEMPOTENTE: tabela nova.

CREATE TABLE IF NOT EXISTS "AptidaoOperacionalPais" (
    "id" SERIAL NOT NULL,
    "usuarioId" INTEGER NOT NULL,
    "paisId" INTEGER NOT NULL,
    "criadoPorId" INTEGER,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AptidaoOperacionalPais_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "AptidaoOperacionalPais_usuarioId_paisId_key" ON "AptidaoOperacionalPais"("usuarioId", "paisId");
CREATE INDEX IF NOT EXISTS "AptidaoOperacionalPais_paisId_idx" ON "AptidaoOperacionalPais"("paisId");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AptidaoOperacionalPais_usuarioId_fkey') THEN
    ALTER TABLE "AptidaoOperacionalPais" ADD CONSTRAINT "AptidaoOperacionalPais_usuarioId_fkey"
      FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AptidaoOperacionalPais_paisId_fkey') THEN
    ALTER TABLE "AptidaoOperacionalPais" ADD CONSTRAINT "AptidaoOperacionalPais_paisId_fkey"
      FOREIGN KEY ("paisId") REFERENCES "CatalogoPais"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AptidaoOperacionalPais_criadoPorId_fkey') THEN
    ALTER TABLE "AptidaoOperacionalPais" ADD CONSTRAINT "AptidaoOperacionalPais_criadoPorId_fkey"
      FOREIGN KEY ("criadoPorId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
