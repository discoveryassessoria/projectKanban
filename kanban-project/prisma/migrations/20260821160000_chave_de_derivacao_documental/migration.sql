-- A NOVA VIA PASSA A SER IDEMPOTENTE SOB CONCORRÊNCIA.
--
-- A idempotência anterior era ler-e-então-escrever: procurar a marca no texto de
-- observação e criar se não achasse. Duas requisições simultâneas leem "não existe"
-- ao mesmo tempo e criam duas vias — foi o que a matriz de concorrência produziu.
--
-- Ler antes de escrever não é idempotência sob concorrência; é uma janela. Quem
-- fecha janela é o banco.
ALTER TABLE "Documento" ADD COLUMN "chaveDerivacao" VARCHAR(200);
CREATE UNIQUE INDEX "Documento_chaveDerivacao_key" ON "Documento"("chaveDerivacao");
