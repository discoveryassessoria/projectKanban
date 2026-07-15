-- ============================================================================
-- R17 — Sem sobreposição de VIGÊNCIA para o mesmo contexto e mesma prioridade.
-- ----------------------------------------------------------------------------
-- O unique da R16 só barra vigências IDÊNTICAS. A R17 exige impedir PERÍODOS
-- SOBREPOSTOS concorrendo para a mesma entidade+contexto, SALVO quando houver
-- diferença explícita e determinística de especificidade → aqui a "prioridade".
--
-- EXCLUDE via GiST: dimensões de contexto com igualdade (=); vigência como
-- daterange com sobreposição (&&). "prioridade" entra com = ⇒ prioridades
-- diferentes PODEM se sobrepor (especificidade explícita permitida pela R17);
-- mesma prioridade, não.
--
-- Vigência é VarChar(10) 'YYYY-MM-DD'. Índices exigem expressão IMMUTABLE, e o
-- cast texto→date (`::date` / `to_date`) é apenas STABLE no Postgres (depende de
-- DateStyle). Usamos `discovery_iso_to_date`, uma função IMMUTABLE baseada em
-- make_date (imutável), que parseia o formato ISO fixo. Assim o EXCLUDE é válido
-- SEM alterar o tipo da coluna (evita ripple no resolver/API/UI que tratam string).
-- A API (POST/PUT) passa a validar o formato ISO 'YYYY-MM-DD' antes de gravar.
-- (Follow-up recomendado: promover a coluna a `date` nativo quando conveniente.)
--
-- O predicado WHERE exclui os 14 placeholders arquivados legados.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Parser ISO IMMUTABLE ('YYYY-MM-DD' → date). NULL/'' = aberto/infinito.
CREATE OR REPLACE FUNCTION discovery_iso_to_date(txt text)
RETURNS date
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN txt IS NULL OR txt = '' THEN NULL
    ELSE make_date(
      substring(txt FROM 1 FOR 4)::int,
      substring(txt FROM 6 FOR 2)::int,
      substring(txt FROM 9 FOR 2)::int
    )
  END
$$;

ALTER TABLE "TabelaValor"
  ADD CONSTRAINT "TabelaValor_vigencia_sem_sobreposicao_excl"
  EXCLUDE USING gist (
    "configuracaoFinanceiraItemId" WITH =,
    COALESCE("processoTipoId", '') WITH =,
    COALESCE("modalidadeId", -1) WITH =,
    COALESCE("fornecedorId", -1) WITH =,
    "moeda" WITH =,
    COALESCE("unidade", '') WITH =,
    COALESCE("quantidadeMinima", '-1'::numeric) WITH =,
    COALESCE("quantidadeMaxima", '-1'::numeric) WITH =,
    "prioridade" WITH =,
    daterange(
      discovery_iso_to_date("vigenciaInicio"),
      discovery_iso_to_date("vigenciaFim"),
      '[]'
    ) WITH &&
  )
  WHERE ("arquivado" = false AND "configuracaoFinanceiraItemId" IS NOT NULL);
