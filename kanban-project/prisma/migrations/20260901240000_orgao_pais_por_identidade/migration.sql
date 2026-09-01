-- O PAÍS DO ÓRGÃO DEIXA DE SER TEXTO.
--
-- `OrgaoProtocolo.country` guardava o nome do país por extenso e sustentava a
-- anti-duplicidade do cadastro mestre: @@unique([name, country]). Duas grafias
-- do mesmo país eram dois países para o banco — e a mesma entidade entrava duas
-- vezes sem nada reclamar.
--
-- A regra continua a mesma ("a mesma entidade não entra duas vezes"); o que
-- muda é a âncora: passa a ser a IDENTIDADE do país.
--
-- Auditoria imediatamente antes: 262 órgãos, 0 com paisId nulo, 0 FK órfã,
-- 0 divergência entre country e o rótulo canônico, 0 colisões em (name, paisId).
--
-- `paisId` continua OPCIONAL, como `country` era: órgão sem país cadastrado
-- permanece possível e, como NULL não colide em índice único no Postgres,
-- o comportamento de unicidade é o mesmo de antes.

-- A unicidade nova entra ANTES do drop: em nenhum instante a tabela fica
-- sem proteção contra a mesma entidade duplicada.
CREATE UNIQUE INDEX "OrgaoProtocolo_name_paisId_key" ON "OrgaoProtocolo"("name", "paisId");
DROP INDEX IF EXISTS "OrgaoProtocolo_name_country_key";
DROP INDEX IF EXISTS "OrgaoProtocolo_country_idx";

ALTER TABLE "OrgaoProtocolo" DROP COLUMN "country";
