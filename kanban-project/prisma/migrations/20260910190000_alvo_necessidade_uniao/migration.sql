-- GRÃO da NecessidadeDocumental que a Regra Documental materializa.
--
-- Casamento é ato entre DUAS pessoas — o materializador criava uma
-- NecessidadeDocumental de "Certidão de casamento" POR CÔNJUGE, pedindo a
-- mesma certidão duas vezes pro mesmo casal. Nascimento/óbito continuam por
-- PESSOA (correto); casamento passa a ser por UNIÃO — a coluna diz qual regra
-- é qual. Default PESSOA preserva todo comportamento já publicado; só a regra
-- de casamento muda de alvo (ver seed abaixo).
--
-- Aditiva, idempotente: enum + coluna novos, default PESSOA, sem tocar dado
-- existente.

DO $$ BEGIN
  CREATE TYPE "AlvoNecessidadeRegra" AS ENUM ('PESSOA', 'UNIAO');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

ALTER TABLE "MatrizDocumental" ADD COLUMN IF NOT EXISTS "alvoNecessidade" "AlvoNecessidadeRegra" NOT NULL DEFAULT 'PESSOA';
