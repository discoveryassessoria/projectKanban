-- ============================================================================
-- R14/R15 — Integridade da Configuração Financeira (ProdutoFinanceiro)
-- ----------------------------------------------------------------------------
-- Invariante REAL do design (confirmado no POST de /produtos):
--   • itemCatalogoId (pivô/spine) é SEMPRE preenchido;
--   • NO MÁXIMO um mestre de domínio entre {tipoDocumento, honorario, tipoProcesso};
--     - Documento/Honorário/Processo → o FK do mestre + itemCatalogo(espelho);
--     - Serviço/Produto            → nenhum FK de domínio; o próprio ItemCatalogo é o mestre.
--   ⇒ "exatamente um mestre" = (≤1 mestre de domínio) + (pivô obrigatório).
-- R15: papel financeiro é obrigatório e controlado (enum PapelFinanceiro).
--
-- Convenção do repo: constraints não representáveis no schema.prisma vivem só
-- aqui (idem TabelaValor_config_contexto_ativo_key do F4). Tabela hoje VAZIA em
-- produção → aplicação sem risco de violar linhas existentes.
-- ============================================================================

-- R14 — no máximo um mestre de domínio por configuração
ALTER TABLE "ProdutoFinanceiro"
  ADD CONSTRAINT "ProdutoFinanceiro_um_mestre_dominio_check"
  CHECK (
    (("tipoDocumentoId" IS NOT NULL)::int
   + ("honorarioId"     IS NOT NULL)::int
   + ("tipoProcessoId"  IS NOT NULL)::int) <= 1
  );

-- R14 — pivô (spine) sempre presente: nenhuma config órfã de ItemCatalogo
ALTER TABLE "ProdutoFinanceiro"
  ADD CONSTRAINT "ProdutoFinanceiro_pivo_obrigatorio_check"
  CHECK ("itemCatalogoId" IS NOT NULL);

-- R15 — papel financeiro obrigatório (CUSTO/RECEITA/... — nunca vazio)
ALTER TABLE "ProdutoFinanceiro"
  ADD CONSTRAINT "ProdutoFinanceiro_papel_obrigatorio_check"
  CHECK ("papelFinanceiro" IS NOT NULL);

-- R16 (nível config) — uma única configuração ativa por (mestre de domínio × papel).
-- Índices parciais: só restringem quando o mestre daquele tipo está preenchido
-- (NULLs distintos no Postgres não colidem). Complementam o já existente
-- ProdutoFinanceiro_itemCatalogoId_papelFinanceiro_key (que cobre Serviço/Produto).
CREATE UNIQUE INDEX "ProdutoFinanceiro_tipoDocumento_papel_key"
  ON "ProdutoFinanceiro" ("tipoDocumentoId", "papelFinanceiro")
  WHERE "tipoDocumentoId" IS NOT NULL;

CREATE UNIQUE INDEX "ProdutoFinanceiro_honorario_papel_key"
  ON "ProdutoFinanceiro" ("honorarioId", "papelFinanceiro")
  WHERE "honorarioId" IS NOT NULL;

CREATE UNIQUE INDEX "ProdutoFinanceiro_tipoProcesso_papel_key"
  ON "ProdutoFinanceiro" ("tipoProcessoId", "papelFinanceiro")
  WHERE "tipoProcessoId" IS NOT NULL;
