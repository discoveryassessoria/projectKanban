-- O INVARIANTE DE VÍNCULO DA COLUNA, AMPLIADO PARA A COLUNA DE ETAPA.
--
-- O CHECK anterior exigia exatamente um de (configId, tipoDocumentoId) — o que
-- era certo enquanto toda coluna era UM item do Cadastro Mestre. A coluna de
-- ETAPA não tem item próprio: quem entrega o item é o registro da linha, e o
-- que ela declara é a CATEGORIA que delimita os itens aceitos.
--
-- O invariante continua existindo, agora com três formas válidas e nenhuma
-- outra. Em particular, uma coluna ITEM_DO_REGISTRO sem categoria seria uma
-- coluna que resolve qualquer item que a linha apontar — exatamente a confusão
-- entre as duas dimensões que esta mudança existe para acabar.
ALTER TABLE "PlanilhaDocumentalColuna"
  DROP CONSTRAINT IF EXISTS "PlanilhaDocumentalColuna_origem_unica_chk";

ALTER TABLE "PlanilhaDocumentalColuna"
  ADD CONSTRAINT "PlanilhaDocumentalColuna_vinculo_chk" CHECK (
    (estrategia = 'SERVICO_FIXO' AND origem = 'SERVICO'   AND "configId" IS NOT NULL AND "tipoDocumentoId" IS NULL     AND "categoriaItemId" IS NULL)
    OR
    (estrategia = 'SERVICO_FIXO' AND origem = 'DOCUMENTO' AND "tipoDocumentoId" IS NOT NULL AND "configId" IS NULL      AND "categoriaItemId" IS NULL)
    OR
    (estrategia = 'ITEM_DO_REGISTRO' AND "categoriaItemId" IS NOT NULL AND "configId" IS NULL AND "tipoDocumentoId" IS NULL)
  );
