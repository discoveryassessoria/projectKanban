-- O ESPELHO TEXTUAL DA MODALIDADE MORRE.
--
-- `ModalidadePais.countryKey` era cópia da chave do país. A identidade já é
-- `paisId`; a chave única passa a ser (paisId, modalityKey) — a mesma regra de
-- negócio ("um país não tem duas modalidades com a mesma chave"), agora
-- expressa sobre a identidade em vez de sobre texto.
--
-- Auditoria imediatamente antes: 8 linhas, 0 com paisId nulo, 0 divergência
-- com o país canônico, 0 duplicata em (paisId, modalityKey).

ALTER TABLE "ModalidadePais" ALTER COLUMN "paisId" SET NOT NULL;

-- A unicidade migra ANTES do drop: em nenhum instante a tabela fica sem ela.
CREATE UNIQUE INDEX "ModalidadePais_paisId_modalityKey_key" ON "ModalidadePais"("paisId", "modalityKey");
DROP INDEX IF EXISTS "ModalidadePais_countryKey_modalityKey_key";
DROP INDEX IF EXISTS "ModalidadePais_countryKey_idx";

ALTER TABLE "ModalidadePais" DROP COLUMN "countryKey";
