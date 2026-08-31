-- ============================================================================
-- IDENTIDADE CANÔNICA — as quatro fontes paralelas ganham FK
-- ----------------------------------------------------------------------------
-- ADITIVA + BACKFILL. Nenhuma coluna antiga é removida: elas continuam gravadas
-- como ESPELHO derivado, porque ainda têm leitores. O que muda é quem é a FONTE
-- DE VERDADE — passa a ser a FK.
--
-- COBERTURA MEDIDA EM PRODUÇÃO ANTES DE ESCREVER ISTO:
--   Processo.pais ............ 2 linhas ('espanha','italia') → CatalogoPais.countryKey: 2/2
--   Documento.tipo ........... 0 linhas · ponte legacyEnumKey cobre 17 de 18 cadastros
--   Solicitacao.canal ........ 0 linhas · CanalOperacional tem as 8 chaves do enum
--   MatrizDocumental ......... 6 regras · 0 órfãos em documentTypeCode e tipoProcessoId
--
-- Por isso o backfill é determinístico: não há linha que ele não saiba resolver.
-- As FKs ficam NULLABLE nesta migration de propósito — tornar obrigatório antes
-- de todos os writers gravarem a identidade transformaria um writer esquecido em
-- erro de produção. A obrigatoriedade entra depois, com cobertura reverificada.
-- ============================================================================

ALTER TABLE "Processo"             ADD COLUMN IF NOT EXISTS "paisId" INTEGER;
-- Documento NÃO ganha coluna: a identidade canônica do tipo JÁ EXISTIA como
-- `documentTypeId` (dual-write desde antes). Criar outra seria a terceira fonte.
ALTER TABLE "SolicitacaoDocumento" ADD COLUMN IF NOT EXISTS "canalOperacionalId" INTEGER;
ALTER TABLE "MatrizDocumental"     ADD COLUMN IF NOT EXISTS "documentoTipoId" INTEGER;
ALTER TABLE "MatrizDocumental"     ADD COLUMN IF NOT EXISTS "tipoProcessoRefId" INTEGER;

-- ── BACKFILL ────────────────────────────────────────────────────────────────
-- Resolução por CHAVE do cadastro, nunca por rótulo: `countryKey` e `code` são
-- identidade; `countryLabel` é apresentação e pode mudar amanhã.
UPDATE "Processo" p SET "paisId" = c.id
  FROM "CatalogoPais" c
 WHERE p."paisId" IS NULL AND lower(p.pais) = lower(c."countryKey");

-- Backfill do que já existia: completa `documentTypeId` onde o enum sabe o tipo.
UPDATE "Documento" d SET "documentTypeId" = t.id
  FROM "TipoDocumentoCadastro" t
 WHERE d."documentTypeId" IS NULL AND d.tipo IS NOT NULL AND t."legacyEnumKey" = d.tipo::text;

UPDATE "SolicitacaoDocumento" s SET "canalOperacionalId" = c.id
  FROM "CanalOperacional" c
 WHERE s."canalOperacionalId" IS NULL AND c.key = s.canal::text;

UPDATE "MatrizDocumental" m SET "documentoTipoId" = t.id
  FROM "TipoDocumentoCadastro" t
 WHERE m."documentoTipoId" IS NULL AND t.code = m."documentTypeCode";

UPDATE "MatrizDocumental" m SET "tipoProcessoRefId" = t.id
  FROM "TipoProcessoNacionalidade" t
 WHERE m."tipoProcessoRefId" IS NULL AND t.id = m."tipoProcessoId";

-- ── ÍNDICES ─────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS "Processo_paisId_idx" ON "Processo"("paisId");
CREATE INDEX IF NOT EXISTS "SolicitacaoDocumento_canalOperacionalId_idx" ON "SolicitacaoDocumento"("canalOperacionalId");
CREATE INDEX IF NOT EXISTS "MatrizDocumental_documentoTipoId_idx" ON "MatrizDocumental"("documentoTipoId");
CREATE INDEX IF NOT EXISTS "MatrizDocumental_tipoProcessoRefId_idx" ON "MatrizDocumental"("tipoProcessoRefId");

-- ── INTEGRIDADE ─────────────────────────────────────────────────────────────
-- RESTRICT em todas: cadastro referenciado por fato histórico não some. A
-- inativação continua sendo o caminho — e ela preserva o vínculo, que é o que
-- faz o histórico continuar explicável depois que o item sai de circulação.
DO $$ BEGIN
  ALTER TABLE "Processo" ADD CONSTRAINT "Processo_paisId_fkey"
    FOREIGN KEY ("paisId") REFERENCES "CatalogoPais"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "SolicitacaoDocumento" ADD CONSTRAINT "SolicitacaoDocumento_canalOperacionalId_fkey"
    FOREIGN KEY ("canalOperacionalId") REFERENCES "CanalOperacional"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "MatrizDocumental" ADD CONSTRAINT "MatrizDocumental_documentoTipoId_fkey"
    FOREIGN KEY ("documentoTipoId") REFERENCES "TipoDocumentoCadastro"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "MatrizDocumental" ADD CONSTRAINT "MatrizDocumental_tipoProcessoRefId_fkey"
    FOREIGN KEY ("tipoProcessoRefId") REFERENCES "TipoProcessoNacionalidade"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
