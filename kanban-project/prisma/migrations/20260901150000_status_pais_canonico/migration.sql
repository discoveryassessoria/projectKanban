-- ============================================================================
-- STATUS E TAREFA — as duas últimas identidades textuais de país saem
-- ----------------------------------------------------------------------------
-- `Status.pais` era a SEGUNDA fonte textual de país do sistema, e `Tarefa.pais`
-- a terceira. Nenhuma das duas é um conceito diferente: as duas guardavam a
-- nacionalidade do trabalho em texto, ao lado do Cadastro Mestre.
--
-- CARDINALIDADE VERIFICADA, NÃO PRESUMIDA: um Status pertence a exatamente UM
-- país. O `@@unique([nome, pais])` que já existia dizia isso, e a rota de
-- criação numera a ordem POR PAÍS — só faz sentido com 1:N. Por isso FK simples,
-- e não tabela N:N.
--
-- DADOS: `Status` tem 0 linhas e 0 tarefas vinculadas (`Tarefa.statusId` nulo em
-- todas); `Tarefa.pais` está vazia. Não há mapeamento a fazer nem dado a
-- preservar — a migração é estrutural.
--
-- `Tarefa.pais` sai em vez de virar FK porque a tarefa não tem nacionalidade
-- própria: ela pertence a um processo, e o processo tem a identidade. Duas
-- colunas para o mesmo fato é como elas divergem.
-- ============================================================================

ALTER TABLE "Status" DROP CONSTRAINT IF EXISTS "Status_nome_pais_key";
DROP INDEX IF EXISTS "Status_pais_idx";
ALTER TABLE "Status" DROP COLUMN IF EXISTS "pais";
ALTER TABLE "Status" ADD COLUMN IF NOT EXISTS "paisId" INTEGER NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "Status_nome_paisId_key" ON "Status"("nome", "paisId");
CREATE INDEX IF NOT EXISTS "Status_paisId_idx" ON "Status"("paisId");

DO $$ BEGIN
  ALTER TABLE "Status" ADD CONSTRAINT "Status_paisId_fkey"
    FOREIGN KEY ("paisId") REFERENCES "CatalogoPais"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DROP INDEX IF EXISTS "Tarefa_pais_idx";
ALTER TABLE "Tarefa" DROP COLUMN IF EXISTS "pais";
