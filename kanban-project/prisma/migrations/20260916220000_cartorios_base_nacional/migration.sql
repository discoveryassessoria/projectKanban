-- BASE NACIONAL DE CARTÓRIOS DE REGISTRO CIVIL — sincronizada automaticamente da
-- fonte pública oficial (Portal da Transparência do Registro Civil,
-- transparencia.registrocivil.org.br/api/notary). Tabela NOVA, isolada de
-- OrgaoProtocolo (cadastro mestre admin-curado): ver comentário do model
-- `Cartorio` em schema.prisma. Aditivo — nenhuma tabela existente é alterada.

CREATE TABLE IF NOT EXISTS "Cartorio" (
  "id"                      SERIAL PRIMARY KEY,
  "sourceId"                VARCHAR(40) NOT NULL,
  "source"                  VARCHAR(40) NOT NULL DEFAULT 'REGISTRO_CIVIL_TRANSPARENCIA',
  "cns"                     VARCHAR(20),
  "nome"                    VARCHAR(300) NOT NULL,
  "nomeNormalizado"         VARCHAR(300) NOT NULL,
  "uf"                      VARCHAR(2) NOT NULL,
  "municipio"               VARCHAR(150) NOT NULL,
  "endereco"                VARCHAR(400),
  "telefone"                VARCHAR(60),
  "email"                   VARCHAR(200),
  "responsavel"             VARCHAR(200),
  "regiao"                  VARCHAR(20),
  "entidade"                VARCHAR(60),
  "ativo"                   BOOLEAN NOT NULL DEFAULT true,
  "firstSeenAt"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt"              TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSyncedAt"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "missingSince"            TIMESTAMP(3),
  "consecutiveMissingSyncs" INTEGER NOT NULL DEFAULT 0,
  "createdAt"               TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"               TIMESTAMP(3) NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "Cartorio_sourceId_key" ON "Cartorio"("sourceId");
CREATE INDEX IF NOT EXISTS "Cartorio_uf_municipio_idx" ON "Cartorio"("uf", "municipio");
CREATE INDEX IF NOT EXISTS "Cartorio_nomeNormalizado_idx" ON "Cartorio"("nomeNormalizado");
CREATE INDEX IF NOT EXISTS "Cartorio_ativo_idx" ON "Cartorio"("ativo");
CREATE INDEX IF NOT EXISTS "Cartorio_cns_idx" ON "Cartorio"("cns");

CREATE TABLE IF NOT EXISTS "CartorioSyncRun" (
  "id"           SERIAL PRIMARY KEY,
  "startedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finishedAt"   TIMESTAMP(3),
  "status"       VARCHAR(30) NOT NULL,
  "source"       VARCHAR(40) NOT NULL DEFAULT 'REGISTRO_CIVIL_TRANSPARENCIA',
  "gatilho"      VARCHAR(30) NOT NULL,
  "fetched"      INTEGER NOT NULL DEFAULT 0,
  "inserted"     INTEGER NOT NULL DEFAULT 0,
  "updated"      INTEGER NOT NULL DEFAULT 0,
  "unchanged"    INTEGER NOT NULL DEFAULT 0,
  "missing"      INTEGER NOT NULL DEFAULT 0,
  "inactivated"  INTEGER NOT NULL DEFAULT 0,
  "errors"       INTEGER NOT NULL DEFAULT 0,
  "errorMessage" TEXT
);

CREATE INDEX IF NOT EXISTS "CartorioSyncRun_startedAt_idx" ON "CartorioSyncRun"("startedAt");
CREATE INDEX IF NOT EXISTS "CartorioSyncRun_status_idx" ON "CartorioSyncRun"("status");
