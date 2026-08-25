-- A PROFISSÃO VIRA CADASTRO.
--
-- `Profissional.categoria` nasceu ontem como texto aberto, com o argumento de que "a
-- próxima profissão não pode exigir migration". O argumento é verdadeiro — e vale
-- para qualquer campo que o guard de referências pega, o que significa que ele não
-- decide nada. O sistema já resolve isso com cadastro, e criar um custa uma linha no
-- registro genérico, não um deploy.
--
-- Sem cadastro, "advogado" e "Advogado" eram duas profissões, e ninguém conseguia
-- perguntar quais existem.
--
-- SEGURO POR CONSTRUÇÃO: `Profissional` tem zero linhas em produção (medido em
-- 25/08/2026), então a coluna nasce NOT NULL sem backfill nem default mentiroso.

CREATE TABLE IF NOT EXISTS "CategoriaProfissional" (
  "id"           SERIAL       PRIMARY KEY,
  "code"         VARCHAR(60)  NOT NULL,
  "nome"         VARCHAR(200) NOT NULL,
  "descricao"    TEXT,
  "ordem"        INTEGER      NOT NULL DEFAULT 0,
  "ativo"        BOOLEAN      NOT NULL DEFAULT true,
  "criadoEm"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "atualizadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "CategoriaProfissional_code_key" ON "CategoriaProfissional"("code");

-- AS PROFISSÕES QUE O SISTEMA JÁ CITAVA, e só essas: as que estavam escritas como
-- sugestão na tela. Nenhuma inventada — quem precisar de outra cadastra.
INSERT INTO "CategoriaProfissional" ("code", "nome", "ordem")
VALUES ('advogado', 'Advogado', 1),
       ('tradutor_juramentado', 'Tradutor juramentado', 2),
       ('despachante', 'Despachante', 3),
       ('contador', 'Contador', 4),
       ('correspondente', 'Correspondente', 5)
ON CONFLICT ("code") DO NOTHING;

-- A COLUNA TEXTUAL SAI. Ela existiu por um dia e nunca recebeu linha; preservá-la
-- seria guardar histórico que não houve.
ALTER TABLE "Profissional" DROP COLUMN IF EXISTS "categoria";
ALTER TABLE "Profissional" ADD COLUMN IF NOT EXISTS "categoriaId" INTEGER NOT NULL
  DEFAULT (SELECT "id" FROM "CategoriaProfissional" WHERE "code" = 'advogado');
ALTER TABLE "Profissional" ALTER COLUMN "categoriaId" DROP DEFAULT;

DO $$ BEGIN
  ALTER TABLE "Profissional" ADD CONSTRAINT "Profissional_categoriaId_fkey"
    FOREIGN KEY ("categoriaId") REFERENCES "CategoriaProfissional"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DROP INDEX IF EXISTS "Profissional_categoria_idx";
CREATE INDEX IF NOT EXISTS "Profissional_categoriaId_idx" ON "Profissional"("categoriaId");
