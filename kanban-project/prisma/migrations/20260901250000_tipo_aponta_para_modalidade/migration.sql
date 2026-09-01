-- A OFERTA PASSA A APONTAR PARA A MODALIDADE.
--
-- `TipoProcessoNacionalidade` guardava modalityKey + modalityLabel: a chave e o
-- rótulo da modalidade, copiados de `ModalidadePais`. Era a mesma duplicação do
-- país, uma tabela adiante — inclusive com a mesma consequência: editar o nome
-- de uma modalidade disparava um updateMany para reescrever a cópia.
--
-- `ModalidadePais` é a modalidade DE UM PAÍS (o par (paisId, modalityKey) é
-- único). Apontar para a linha resolve chave e rótulo de uma vez só.
--
-- Esta migration só ACRESCENTA e preenche. O drop dos espelhos vem depois, com
-- os consumidores migrados.

ALTER TABLE "TipoProcessoNacionalidade" ADD COLUMN "modalidadeId" INTEGER;

-- Backfill pelo par que já era único: mesmo país, mesma chave de modalidade.
UPDATE "TipoProcessoNacionalidade" t
   SET "modalidadeId" = m.id
  FROM "ModalidadePais" m
 WHERE m."paisId" = t."paisId"
   AND m."modalityKey" = t."modalityKey";

-- SE ALGUMA LINHA NÃO RESOLVEU, A MIGRATION PARA. Vínculo obrigatório com
-- buraco é pior que espelho: some com a oferta em vez de duplicá-la.
DO $$
DECLARE n INTEGER;
BEGIN
  SELECT COUNT(*) INTO n FROM "TipoProcessoNacionalidade" WHERE "modalidadeId" IS NULL;
  IF n > 0 THEN
    RAISE EXCEPTION 'backfill incompleto: % tipo(s) sem modalidade canônica', n;
  END IF;
END $$;

ALTER TABLE "TipoProcessoNacionalidade"
  ADD CONSTRAINT "TipoProcessoNacionalidade_modalidadeId_fkey"
  FOREIGN KEY ("modalidadeId") REFERENCES "ModalidadePais"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "TipoProcessoNacionalidade_modalidadeId_idx" ON "TipoProcessoNacionalidade"("modalidadeId");
