-- BASE MUNDIAL DE PAÍSES E CIDADES — seleção travada, nunca texto livre, para
-- formulários de registro civil que hoje só sabem lidar com o Brasil (ex.:
-- EditorRegistralModal). Sincronizada da fonte pública gratuita GeoNames
-- (download.geonames.org). Tabelas NOVAS, isoladas de `CatalogoPais` (cadastro
-- travado/congelado da hierarquia País×Tipo×Modalidade — ver comentário do
-- model `Pais` em schema.prisma). Aditivo — nenhuma tabela existente é alterada.

CREATE TABLE IF NOT EXISTS "Pais" (
  "id"              SERIAL PRIMARY KEY,
  "codigo"          VARCHAR(2) NOT NULL,
  "nome"            VARCHAR(120) NOT NULL,
  "nomeNormalizado" VARCHAR(120) NOT NULL,
  "ativo"           BOOLEAN NOT NULL DEFAULT true,
  "criadoEm"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "atualizadoEm"    TIMESTAMP(3) NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "Pais_codigo_key" ON "Pais"("codigo");
CREATE INDEX IF NOT EXISTS "Pais_nomeNormalizado_idx" ON "Pais"("nomeNormalizado");
CREATE INDEX IF NOT EXISTS "Pais_ativo_idx" ON "Pais"("ativo");

CREATE TABLE IF NOT EXISTS "Cidade" (
  "id"              SERIAL PRIMARY KEY,
  "sourceId"        VARCHAR(20) NOT NULL,
  "nome"            VARCHAR(200) NOT NULL,
  "nomeNormalizado" VARCHAR(200) NOT NULL,
  "regiao"          VARCHAR(200),
  "paisId"          INTEGER NOT NULL,
  "ativo"           BOOLEAN NOT NULL DEFAULT true,
  "criadoEm"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Cidade_paisId_fkey" FOREIGN KEY ("paisId") REFERENCES "Pais"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "Cidade_sourceId_key" ON "Cidade"("sourceId");
CREATE INDEX IF NOT EXISTS "Cidade_paisId_nomeNormalizado_idx" ON "Cidade"("paisId", "nomeNormalizado");
CREATE INDEX IF NOT EXISTS "Cidade_ativo_idx" ON "Cidade"("ativo");
