-- ÓRGÃOS E ORGANIZAÇÕES — cadastro mestre completo.
--
-- A entidade só tinha nome/tipo/país/estado/cidade. Passa a carregar a ficha
-- oficial que a operação de cidadania precisa: código público (ORG1, ORG2…),
-- nome fantasia, endereço, CEP, site, e-mail, telefone, idioma, moeda, horário,
-- responsável, observações e tags.
--
-- 100% ADITIVO E IDEMPOTENTE: nenhuma coluna existente é alterada ou apagada.
-- O código público é gerado no create pela extensão do Prisma Client
-- (CODE_REGISTRY → ORGANIZATION); esta migration só cria a coluna e o índice
-- único. O backfill dos registros antigos é feito pelo seed oficial.

ALTER TABLE "OrgaoProtocolo" ADD COLUMN IF NOT EXISTS "publicCode" VARCHAR(20);
ALTER TABLE "OrgaoProtocolo" ADD COLUMN IF NOT EXISTS "nomeFantasia" VARCHAR(200);
ALTER TABLE "OrgaoProtocolo" ADD COLUMN IF NOT EXISTS "endereco" VARCHAR(300);
ALTER TABLE "OrgaoProtocolo" ADD COLUMN IF NOT EXISTS "cep" VARCHAR(20);
ALTER TABLE "OrgaoProtocolo" ADD COLUMN IF NOT EXISTS "site" VARCHAR(300);
ALTER TABLE "OrgaoProtocolo" ADD COLUMN IF NOT EXISTS "email" VARCHAR(200);
ALTER TABLE "OrgaoProtocolo" ADD COLUMN IF NOT EXISTS "telefone" VARCHAR(60);
ALTER TABLE "OrgaoProtocolo" ADD COLUMN IF NOT EXISTS "idioma" VARCHAR(10);
ALTER TABLE "OrgaoProtocolo" ADD COLUMN IF NOT EXISTS "moeda" VARCHAR(10);
ALTER TABLE "OrgaoProtocolo" ADD COLUMN IF NOT EXISTS "horario" VARCHAR(200);
ALTER TABLE "OrgaoProtocolo" ADD COLUMN IF NOT EXISTS "responsavel" VARCHAR(200);
ALTER TABLE "OrgaoProtocolo" ADD COLUMN IF NOT EXISTS "observacoes" TEXT;
ALTER TABLE "OrgaoProtocolo" ADD COLUMN IF NOT EXISTS "tags" TEXT[] NOT NULL DEFAULT '{}';

CREATE UNIQUE INDEX IF NOT EXISTS "OrgaoProtocolo_publicCode_key" ON "OrgaoProtocolo"("publicCode");
CREATE INDEX IF NOT EXISTS "OrgaoProtocolo_country_idx" ON "OrgaoProtocolo"("country");
CREATE INDEX IF NOT EXISTS "OrgaoProtocolo_ativo_idx" ON "OrgaoProtocolo"("ativo");

-- Anti-duplicidade do cadastro mestre: a mesma entidade não entra duas vezes.
-- Chave natural = nome oficial + país (NULL é distinto no Postgres, então só
-- restringe quando o país está preenchido — que é o caso de todo registro novo).
CREATE UNIQUE INDEX IF NOT EXISTS "OrgaoProtocolo_name_country_key" ON "OrgaoProtocolo"("name", "country");
