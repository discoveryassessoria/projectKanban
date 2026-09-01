-- OS ESPELHOS DA MODALIDADE MORREM.
--
-- `modalityKey` e `modalityLabel` eram cópias de `ModalidadePais`, provadas
-- idênticas linha a linha: 4/4 iguais, 0 divergentes, 0 sem modalidade canônica.
-- A identidade agora é `modalidadeId`, preenchida e verificada na migration
-- anterior — que abortaria se alguma linha não resolvesse.
--
-- Como o par (paisId, modalityKey) já era único em ModalidadePais, apontar para
-- a LINHA devolve chave e rótulo sem ambiguidade. Nada se perde.

ALTER TABLE "TipoProcessoNacionalidade" ALTER COLUMN "modalidadeId" SET NOT NULL;

DROP INDEX IF EXISTS "TipoProcessoNacionalidade_modalityKey_idx";

ALTER TABLE "TipoProcessoNacionalidade"
  DROP COLUMN "modalityKey",
  DROP COLUMN "modalityLabel";
