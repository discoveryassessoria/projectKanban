-- OS QUATRO ESPELHOS TEXTUAIS DA OFERTA MORREM.
--
-- `TipoProcessoNacionalidade` guardava countryKey/countryLabel/nationalityKey/
-- nationalityLabel — cópias byte a byte de `CatalogoPais`. A identidade já é
-- `paisId`; o que sobrava era texto que podia divergir e que obrigava a
-- PROPAGAR rótulo a cada edição de país.
--
-- Auditoria imediatamente antes deste DROP: 4 linhas, 0 com paisId nulo,
-- 0 FK órfã, 0 divergência entre o espelho e o país canônico.

-- 1) Sem país não existe oferta: a identidade passa a ser obrigatória.
ALTER TABLE "TipoProcessoNacionalidade" ALTER COLUMN "paisId" SET NOT NULL;

-- 2) O índice do espelho não tem mais o que indexar (o de paisId já existe).
DROP INDEX IF EXISTS "TipoProcessoNacionalidade_countryKey_idx";

-- 3) As cópias saem fisicamente.
ALTER TABLE "TipoProcessoNacionalidade"
  DROP COLUMN "countryKey",
  DROP COLUMN "countryLabel",
  DROP COLUMN "nationalityKey",
  DROP COLUMN "nationalityLabel";
