-- CÓDIGO PÚBLICO DO TIPO DE DOCUMENTO — padrão DOC1, DOC2, DOC3…
--
-- O código é gerado pelo CodeGeneratorService no create e nunca é editável. Esta
-- migration alinha o que JÁ EXISTE ao novo padrão, em três passos idempotentes:
--   1. converte os códigos antigos TDOC-n → DOCn (mesmo número, sem separador);
--   2. atribui código aos tipos que ainda estão sem nenhum (numeração contínua);
--   3. semeia a sequência (escopo TDOC) no maior número gravado, para o próximo
--      create continuar de onde parou e nunca reaproveitar número.
--
-- O escopo da sequência continua TDOC de propósito: o DOC-n do documento CONCRETO
-- tem contador próprio e não pode ser compartilhado. A unicidade de publicCode é
-- por tabela, então DOC7 (tipo) e DOC-7 (documento) coexistem sem colidir.
-- Nenhum registro é criado ou apagado.

-- 1) TDOC-n → DOCn
UPDATE "TipoDocumentoCadastro"
   SET "publicCode" = 'DOC' || substring("publicCode" from '([0-9]+)$')
 WHERE "publicCode" ~ '^TDOC-[0-9]+$';

-- 2) tipos sem código: numeração contínua a partir do maior DOCn existente
WITH maior AS (
  SELECT COALESCE(MAX(CAST(substring("publicCode" from '([0-9]+)$') AS INT)), 0) AS n
    FROM "TipoDocumentoCadastro"
   WHERE "publicCode" LIKE 'DOC%'
), novos AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY id) AS seq
    FROM "TipoDocumentoCadastro"
   WHERE "publicCode" IS NULL
)
UPDATE "TipoDocumentoCadastro" t
   SET "publicCode" = 'DOC' || (maior.n + novos.seq)
  FROM novos, maior
 WHERE t.id = novos.id;

-- 3) sequência do escopo TDOC >= maior número gravado (monotônica, nunca retrocede)
INSERT INTO "CodeSequence" ("scope", "ultimo", "atualizadoEm")
SELECT 'TDOC',
       COALESCE(MAX(CAST(substring("publicCode" from '([0-9]+)$') AS INT)), 0),
       now()
  FROM "TipoDocumentoCadastro"
 WHERE "publicCode" LIKE 'DOC%'
ON CONFLICT ("scope") DO UPDATE
   SET "ultimo" = GREATEST("CodeSequence"."ultimo", EXCLUDED."ultimo"),
       "atualizadoEm" = now();
