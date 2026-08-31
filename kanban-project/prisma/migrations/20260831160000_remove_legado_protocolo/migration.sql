-- ============================================================================
-- REMOÇÃO DO LEGADO DE PROTOCOLO
-- ----------------------------------------------------------------------------
-- Esta migration REMOVE. Ela é a segunda metade das duas anteriores, que foram
-- aditivas de propósito: primeiro o novo passa a existir e o código migra, só
-- depois o velho sai. Sai agora porque nada mais o lê.
--
--   · Protocolo.requerenteId   → o escopo é `ProtocoloRequerente`, que cabe um
--     (Espanha) ou a família inteira (Itália). A coluna cabia UM.
--   · Protocolo.consulado / consuladoOutro → o órgão vem de Órgãos e
--     Organizações desde antes; a coluna já estava marcada LEGADO.
--   · Protocolo.tipoProtocolo + enum TipoProtocolo → virou cadastro.
--   · InformacaoItalia (+ anexos) e enum Tribunal → tribunal é uma organização
--     como outra qualquer, e o ruolo generale mora em `Protocolo.numeroProcesso`.
--     Uma tabela por país nunca serviria à Espanha.
--
-- SEGURANÇA: em produção estas colunas e tabelas estão VAZIAS — os dois campos
-- de protocolo nunca foram gravados e `InformacaoItalia` tem 0 linhas. Não há
-- dado a preservar, e por isso a remoção é direta em vez de faseada.
-- ============================================================================

ALTER TABLE "Protocolo" DROP COLUMN IF EXISTS "requerenteId";
ALTER TABLE "Protocolo" DROP COLUMN IF EXISTS "consulado";
ALTER TABLE "Protocolo" DROP COLUMN IF EXISTS "consuladoOutro";
ALTER TABLE "Protocolo" DROP COLUMN IF EXISTS "tipoProtocolo";

DROP TABLE IF EXISTS "AnexoInformacaoItalia";
DROP TABLE IF EXISTS "InformacaoItalia";

DROP TYPE IF EXISTS "TipoProtocolo";
DROP TYPE IF EXISTS "Tribunal";
DROP TYPE IF EXISTS "Consulado";
