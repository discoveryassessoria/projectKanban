-- ============================================================================
-- O LEGADO MORRE — e o que sobrevive deixa de poder divergir
-- ----------------------------------------------------------------------------
-- Duas coisas diferentes, e a distinção importa:
--
-- 1) O QUE NÃO TEM MAIS NENHUM CONSUMIDOR É REMOVIDO AGORA.
--    · enum `Pais` — ZERO colunas no schema e ZERO importadores no código. Peso
--      morto que existia ao lado de `CatalogoPais` fingindo ser uma fonte.
--    · `MatrizDocumental.modalidadeId`, `paisCode`, `regiaoCode` — marcados
--      LEGADO no próprio schema; a varredura mostrou que só eram carregados de
--      um lado para o outro como `?? null`, sem nenhuma lógica lendo o valor.
--
-- 2) O QUE AINDA TEM LEITORES NÃO É REMOVIDO — É AMARRADO.
--    `Processo.pais` tem 85 leitores em 20+ arquivos; `Documento.tipo`,
--    `SolicitacaoDocumento.canal` e `MatrizDocumental.documentTypeCode` têm os
--    seus. Removê-los hoje quebraria produção, e migrar 85 leitores de uma vez
--    sem cobertura de teste seria trocar uma dívida por um incidente.
--
--    Em vez disso, eles deixam de poder SER fonte: um trigger passa a derivá-los
--    da FK a cada escrita. A partir daqui é fisicamente impossível gravar um
--    texto que discorde da identidade — mesmo por SQL direto, mesmo por um
--    writer novo que ninguém revisou. A coluna continua legível e deixa de ser
--    verdade; a remoção vira limpeza sem risco, leitor a leitor.
-- ============================================================================

-- ── 1. REMOÇÃO DO QUE ESTÁ MORTO ────────────────────────────────────────────
ALTER TABLE "MatrizDocumental" DROP COLUMN IF EXISTS "modalidadeId";
ALTER TABLE "MatrizDocumental" DROP COLUMN IF EXISTS "paisCode";
ALTER TABLE "MatrizDocumental" DROP COLUMN IF EXISTS "regiaoCode";
DROP TYPE IF EXISTS "Pais";

-- ── 2. ESPELHOS DERIVADOS POR TRIGGER ───────────────────────────────────────
-- Regra comum: quando a identidade existe, ela MANDA. Quando ainda é nula
-- (linha antiga que o backfill não alcançou), o texto é preservado — nenhuma
-- migração apaga informação que ela não sabe reconstruir.

CREATE OR REPLACE FUNCTION "processo_pais_espelha_identidade"()
RETURNS TRIGGER AS $trg$
BEGIN
  IF NEW."paisId" IS NOT NULL THEN
    SELECT c."countryKey" INTO NEW.pais FROM "CatalogoPais" c WHERE c.id = NEW."paisId";
  END IF;
  RETURN NEW;
END;
$trg$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS "trg_processo_pais_espelho" ON "Processo";
CREATE TRIGGER "trg_processo_pais_espelho"
  BEFORE INSERT OR UPDATE ON "Processo"
  FOR EACH ROW EXECUTE FUNCTION "processo_pais_espelha_identidade"();

CREATE OR REPLACE FUNCTION "documento_tipo_espelha_identidade"()
RETURNS TRIGGER AS $trg$
DECLARE v_legacy TEXT;
BEGIN
  IF NEW."documentTypeId" IS NOT NULL THEN
    SELECT t."legacyEnumKey" INTO v_legacy FROM "TipoDocumentoCadastro" t WHERE t.id = NEW."documentTypeId";
    -- Tipo cadastrado depois da migração não tem enum equivalente, e está certo
    -- que o espelho fique nulo: o enum é o legado, não a fonte.
    NEW.tipo := CASE WHEN v_legacy IS NULL THEN NULL ELSE v_legacy::"TipoDocumento" END;
  END IF;
  RETURN NEW;
END;
$trg$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS "trg_documento_tipo_espelho" ON "Documento";
CREATE TRIGGER "trg_documento_tipo_espelho"
  BEFORE INSERT OR UPDATE ON "Documento"
  FOR EACH ROW EXECUTE FUNCTION "documento_tipo_espelha_identidade"();

CREATE OR REPLACE FUNCTION "solicitacao_canal_espelha_identidade"()
RETURNS TRIGGER AS $trg$
DECLARE v_key TEXT;
BEGIN
  IF NEW."canalOperacionalId" IS NOT NULL THEN
    SELECT c.key INTO v_key FROM "CanalOperacional" c WHERE c.id = NEW."canalOperacionalId";
    IF v_key IS NOT NULL THEN
      NEW.canal := v_key::"CanalSolicitacaoDocumento";
    END IF;
  END IF;
  RETURN NEW;
END;
$trg$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS "trg_solicitacao_canal_espelho" ON "SolicitacaoDocumento";
CREATE TRIGGER "trg_solicitacao_canal_espelho"
  BEFORE INSERT OR UPDATE ON "SolicitacaoDocumento"
  FOR EACH ROW EXECUTE FUNCTION "solicitacao_canal_espelha_identidade"();

CREATE OR REPLACE FUNCTION "matriz_code_espelha_identidade"()
RETURNS TRIGGER AS $trg$
BEGIN
  IF NEW."documentoTipoId" IS NOT NULL THEN
    SELECT t.code INTO NEW."documentTypeCode" FROM "TipoDocumentoCadastro" t WHERE t.id = NEW."documentoTipoId";
  END IF;
  IF NEW."tipoProcessoRefId" IS NOT NULL THEN
    NEW."tipoProcessoId" := NEW."tipoProcessoRefId";
  END IF;
  RETURN NEW;
END;
$trg$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS "trg_matriz_code_espelho" ON "MatrizDocumental";
CREATE TRIGGER "trg_matriz_code_espelho"
  BEFORE INSERT OR UPDATE ON "MatrizDocumental"
  FOR EACH ROW EXECUTE FUNCTION "matriz_code_espelha_identidade"();
