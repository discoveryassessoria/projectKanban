-- ============================================================================
-- M-UNIFICA (2/3) — MERGE de dados: funde os pares CUSTO+RECEITA em UMA config
-- por cadastro mestre. Sobrevivente = MIN(id) por itemCatalogoId (pivô).
--   • copia valorPadrao de cada papel → valorCustoPadrao / valorReceitaPadrao;
--   • seta flags possuiCusto / possuiReceita conforme os papéis presentes;
--   • repontar TODAS as referências (preços, regras econômicas, triggers)
--     do perdedor → sobrevivente;
--   • exclui os perdedores.
-- NENHUM valor é perdido. Idempotente-friendly (roda uma vez no histórico).
-- Estado em prod (15/07): 19 configs, 9 pares CUSTO+RECEITA, 0 preços/regras
-- vinculados → merge limpo. As FKs abaixo cobrem o caso geral mesmo assim.
-- Configs sem pivô (itemCatalogoId IS NULL) NÃO são tocadas (não há chave de merge).
-- ============================================================================

-- 1) Flags + valores no sobrevivente (agrega os papéis do grupo).
WITH grp AS (
  SELECT "itemCatalogoId" AS item,
         MIN(id) AS survivor,
         bool_or("papelFinanceiro" = 'CUSTO')                              AS tem_custo,
         bool_or("papelFinanceiro" = 'RECEITA')                            AS tem_receita,
         MAX("valorPadrao") FILTER (WHERE "papelFinanceiro" = 'CUSTO')     AS v_custo,
         MAX("valorPadrao") FILTER (WHERE "papelFinanceiro" = 'RECEITA')   AS v_receita
  FROM "ProdutoFinanceiro"
  WHERE "itemCatalogoId" IS NOT NULL
  GROUP BY "itemCatalogoId"
)
UPDATE "ProdutoFinanceiro" pf SET
  "possuiCusto"        = g.tem_custo,
  "possuiReceita"      = g.tem_receita,
  "valorCustoPadrao"   = COALESCE(g.v_custo,   pf."valorCustoPadrao"),
  "valorReceitaPadrao" = COALESCE(g.v_receita, pf."valorReceitaPadrao")
FROM grp g
WHERE pf.id = g.survivor;

-- 2) Repontar PREÇOS (perdedor → sobrevivente). natureza do preço é preservada.
UPDATE "TabelaValor" tv SET "configuracaoFinanceiraItemId" = m.survivor
FROM (
  SELECT id AS loser, MIN(id) OVER (PARTITION BY "itemCatalogoId") AS survivor
  FROM "ProdutoFinanceiro" WHERE "itemCatalogoId" IS NOT NULL
) m
WHERE tv."configuracaoFinanceiraItemId" = m.loser AND m.loser <> m.survivor;

-- 3) Repontar REGRAS ECONÔMICAS (custo e receita → mesma config sobrevivente).
UPDATE "PhaseEconomicRule" r SET "custoConfigId" = m.survivor
FROM (
  SELECT id AS loser, MIN(id) OVER (PARTITION BY "itemCatalogoId") AS survivor
  FROM "ProdutoFinanceiro" WHERE "itemCatalogoId" IS NOT NULL
) m
WHERE r."custoConfigId" = m.loser AND m.loser <> m.survivor;

UPDATE "PhaseEconomicRule" r SET "receitaConfigId" = m.survivor
FROM (
  SELECT id AS loser, MIN(id) OVER (PARTITION BY "itemCatalogoId") AS survivor
  FROM "ProdutoFinanceiro" WHERE "itemCatalogoId" IS NOT NULL
) m
WHERE r."receitaConfigId" = m.loser AND m.loser <> m.survivor;

-- 4) Repontar TRIGGERS.
UPDATE "PhaseTriggerRule" r SET "configItemId" = m.survivor
FROM (
  SELECT id AS loser, MIN(id) OVER (PARTITION BY "itemCatalogoId") AS survivor
  FROM "ProdutoFinanceiro" WHERE "itemCatalogoId" IS NOT NULL
) m
WHERE r."configItemId" = m.loser AND m.loser <> m.survivor;

-- 5) Excluir perdedores (mantém só o sobrevivente por mestre; sem pivô fica intacto).
DELETE FROM "ProdutoFinanceiro"
WHERE "itemCatalogoId" IS NOT NULL
  AND id NOT IN (
    SELECT MIN(id) FROM "ProdutoFinanceiro"
    WHERE "itemCatalogoId" IS NOT NULL
    GROUP BY "itemCatalogoId"
  );
