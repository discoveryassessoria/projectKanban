-- ============================================================================
-- M-UNIFICA (3/3) — constraints: reverte R15/R16(config) do papel na chave e
-- promove a chave "UMA config por mestre". Reconstrói R16/R17 de PREÇO incluindo
-- natureza, para custo e receita coexistirem sob a MESMA config. Remove a coluna
-- papelFinanceiro (papel vive só em TabelaValor.natureza).
--
-- Mantém R14 (pivô obrigatório + no máx. 1 mestre de domínio) — segue válido.
-- ============================================================================

-- ── Config: papel sai da chave ──────────────────────────────────────────────
-- R15 (papel obrigatório) revertida — papel não é mais atributo da config.
ALTER TABLE "ProdutoFinanceiro" DROP CONSTRAINT IF EXISTS "ProdutoFinanceiro_papel_obrigatorio_check";

-- R16 (config) e F3: uniques por (mestre × papel) — não fazem mais sentido.
DROP INDEX IF EXISTS "ProdutoFinanceiro_tipoDocumento_papel_key";
DROP INDEX IF EXISTS "ProdutoFinanceiro_honorario_papel_key";
DROP INDEX IF EXISTS "ProdutoFinanceiro_tipoProcesso_papel_key";
DROP INDEX IF EXISTS "ProdutoFinanceiro_itemCatalogoId_papelFinanceiro_key";
DROP INDEX IF EXISTS "ProdutoFinanceiro_papelFinanceiro_idx";

-- UMA configuração por item mestre (pivô). NULLs distintos no Postgres.
CREATE UNIQUE INDEX "ProdutoFinanceiro_itemCatalogoId_key"
  ON "ProdutoFinanceiro" ("itemCatalogoId");

-- Papel financeiro deixa de existir na config.
ALTER TABLE "ProdutoFinanceiro" DROP COLUMN "papelFinanceiro";

-- ── Preço: natureza entra na chave (R16/R17) ────────────────────────────────
-- Sem isto, ao fundir as configs um preço de CUSTO e um de RECEITA no mesmo
-- contexto colidiriam (a chave anterior não continha natureza).
DROP INDEX IF EXISTS "TabelaValor_config_contexto_ativo_key";
CREATE UNIQUE INDEX "TabelaValor_config_contexto_ativo_key"
ON "TabelaValor" (
  "configuracaoFinanceiraItemId",
  "natureza",
  COALESCE("processoTipoId", ''),
  COALESCE("modalidadeId", -1),
  COALESCE("fornecedorId", -1),
  "moeda",
  "modoCalculo",
  COALESCE("unidade", ''),
  COALESCE("quantidadeMinima", '-1'::numeric),
  COALESCE("quantidadeMaxima", '-1'::numeric),
  "prioridade",
  COALESCE("vigenciaInicio", ''),
  COALESCE("vigenciaFim", '')
)
WHERE "arquivado" = false AND "configuracaoFinanceiraItemId" IS NOT NULL;

ALTER TABLE "TabelaValor" DROP CONSTRAINT IF EXISTS "TabelaValor_vigencia_sem_sobreposicao_excl";
ALTER TABLE "TabelaValor"
  ADD CONSTRAINT "TabelaValor_vigencia_sem_sobreposicao_excl"
  EXCLUDE USING gist (
    "configuracaoFinanceiraItemId" WITH =,
    "natureza" WITH =,
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
