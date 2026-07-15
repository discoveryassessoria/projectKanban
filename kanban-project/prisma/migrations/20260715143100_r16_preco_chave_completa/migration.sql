-- ============================================================================
-- R16 — Anti-duplicidade lógica de PREÇO (TabelaValor), chave COMPLETA.
-- ----------------------------------------------------------------------------
-- O índice do F4 (TabelaValor_config_contexto_ativo_key) NÃO incluía
-- moeda / modoCalculo / unidade / faixa de quantidade. Efeito perverso:
-- dois preços LEGÍTIMOS que diferem só por faixa de quantidade (ou moeda/unidade)
-- colidiam e eram rejeitados — contradizendo a relação 1:N (R13).
--
-- Aqui redefinimos a chave para TODAS as dimensões que a R16 lista, de modo que:
--   • variações reais de contexto (moeda, modo, unidade, faixa, vigência) coexistem;
--   • dois registros IDÊNTICOS em todas as dimensões continuam bloqueados.
-- Escopo: apenas preços ativos e canônicos (arquivado=false, config não-nula).
-- ============================================================================

DROP INDEX IF EXISTS "TabelaValor_config_contexto_ativo_key";

CREATE UNIQUE INDEX "TabelaValor_config_contexto_ativo_key"
ON "TabelaValor" (
  "configuracaoFinanceiraItemId",
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
