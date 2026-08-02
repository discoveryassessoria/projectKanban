-- LOTE A — Categoria Documental como FONTE CANÔNICA de classificação documental.
-- ADITIVO e NÃO-DESTRUTIVO: cria tabela nova, faz seed (bootstrap versionado),
-- adiciona coluna nullable + índice + FK RESTRICT. A coluna legada
-- TipoDocumentoCadastro."category" (String) PERMANECE (compat transitória).
-- Nenhum DROP. Aplicar somente com autorização (migrate deploy).

-- 1) Tabela mestre (com flag `sistema` p/ proteger as categorias de bootstrap)
CREATE TABLE "CategoriaDocumental" (
    "id" SERIAL NOT NULL,
    "code" VARCHAR(40) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "description" TEXT,
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "sistema" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CategoriaDocumental_pkey" PRIMARY KEY ("id")
);

-- 2) Índice único de código
CREATE UNIQUE INDEX "CategoriaDocumental_code_key" ON "CategoriaDocumental"("code");

-- 3) SEED (BOOTSTRAP VERSIONADO — dado estrutural, não fonte runtime).
--    Estratégia ÚNICA de criação das 7 sementes: aqui, idempotente por `code`
--    (ON CONFLICT DO NOTHING). Não há rota concorrente de seed. sistema = true
--    ⇒ code imutável e não-excluível (protegido pela API).
INSERT INTO "CategoriaDocumental" ("code","name","ordem","sistema","updatedAt") VALUES
  ('REGISTRO_CIVIL','Registro civil',10,true,CURRENT_TIMESTAMP),
  ('IDENTIDADE','Identidade',20,true,CURRENT_TIMESTAMP),
  ('JUDICIAL','Judicial',30,true,CURRENT_TIMESTAMP),
  ('CONSULAR','Consular',40,true,CURRENT_TIMESTAMP),
  ('TRADUCAO','Tradução',50,true,CURRENT_TIMESTAMP),
  ('APOSTILA','Apostila',60,true,CURRENT_TIMESTAMP),
  ('OUTRO','Outro',70,true,CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;

-- 4) Coluna nullable no consumidor (linhas existentes ficam NULL até o backfill)
ALTER TABLE "TipoDocumentoCadastro" ADD COLUMN "categoriaDocumentalId" INTEGER;

-- 5) Índice da FK
CREATE INDEX "TipoDocumentoCadastro_categoriaDocumentalId_idx" ON "TipoDocumentoCadastro"("categoriaDocumentalId");

-- 6) FK RESTRICT (alinha DB à regra: categoria em uso NÃO pode ser removida;
--    evita desclassificação silenciosa por SQL cru). nullable ⇒ válida com NULL.
ALTER TABLE "TipoDocumentoCadastro"
  ADD CONSTRAINT "TipoDocumentoCadastro_categoriaDocumentalId_fkey"
  FOREIGN KEY ("categoriaDocumentalId") REFERENCES "CategoriaDocumental"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- ROLLBACK (documentado; não executado aqui):
-- ALTER TABLE "TipoDocumentoCadastro" DROP CONSTRAINT "TipoDocumentoCadastro_categoriaDocumentalId_fkey";
-- DROP INDEX "TipoDocumentoCadastro_categoriaDocumentalId_idx";
-- ALTER TABLE "TipoDocumentoCadastro" DROP COLUMN "categoriaDocumentalId";
-- DROP TABLE "CategoriaDocumental";
-- (a coluna legada "category" permanece intacta → zero perda de dados)
