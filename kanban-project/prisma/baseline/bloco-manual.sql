-- ============================================================================
-- BLOCO MANUAL DO BASELINE — objetos que o Prisma NAO consegue expressar.
--
-- ESTE ARQUIVO E' A FONTE. E' mantido a mao e sobrevive a toda regeneracao:
-- `npm run baseline:gerar` monta baseline.sql = cabecalho + corpo gerado a
-- partir do schema.prisma + ESTE arquivo, nesta ordem. O gerador nunca le o
-- baseline.sql, so escreve — por isso nada aqui pode ser perdido.
--
-- NAO EDITE o baseline.sql para acrescentar coisa aqui: sera sobrescrito.
-- Acrescente AQUI.
--
-- A ORDEM IMPORTA: extensao -> funcao -> indices -> constraints. A exclusion
-- constraint depende das duas primeiras; invertendo, ela falha em banco virgem.
--
-- Como saber se algo novo precisa entrar aqui: aplique o baseline num banco
-- vazio e compare com producao (ver README.md, secao "Validar"). Tudo que
-- aparecer so em producao e' candidato.
-- ============================================================================

-- Requisito da exclusion constraint abaixo (operador = em tipos escalares sob gist).
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Usada pela exclusion constraint; criada em 20260715143200_r17_vigencia_sem_sobreposicao.
CREATE OR REPLACE FUNCTION public.discovery_iso_to_date(txt text)
 RETURNS date
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT CASE
    WHEN txt IS NULL OR txt = '' THEN NULL
    ELSE make_date(
      substring(txt FROM 1 FOR 4)::int,
      substring(txt FROM 6 FOR 2)::int,
      substring(txt FROM 9 FOR 2)::int
    )
  END
$function$;

-- unique PARCIAL — o Prisma nao expressa WHERE/COALESCE em @@unique.
CREATE UNIQUE INDEX "NomePessoa_um_principal_ativo" ON "NomePessoa" USING btree ("pessoaId") WHERE ((principal = true) AND (ativo = true));

-- unique PARCIAL — o Prisma nao expressa WHERE/COALESCE em @@unique.
CREATE UNIQUE INDEX "TabelaValor_config_contexto_ativo_key" ON "TabelaValor" USING btree ("configuracaoFinanceiraItemId", natureza, COALESCE("processoTipoId", ''::character varying), COALESCE("modalidadeId", '-1'::integer), COALESCE("fornecedorId", '-1'::integer), moeda, "modoCalculo", COALESCE(unidade, ''::character varying), COALESCE("quantidadeMinima", '-1'::numeric), COALESCE("quantidadeMaxima", '-1'::numeric), prioridade, COALESCE("vigenciaInicio", ''::character varying), COALESCE("vigenciaFim", ''::character varying)) WHERE ((arquivado = false) AND ("configuracaoFinanceiraItemId" IS NOT NULL));

-- EXCLUSION CONSTRAINT — impede vigencias sobrepostas. Sem equivalente no Prisma.
ALTER TABLE "TabelaValor" ADD CONSTRAINT "TabelaValor_vigencia_sem_sobreposicao_excl" EXCLUDE USING gist ("configuracaoFinanceiraItemId" WITH =, natureza WITH =, COALESCE("processoTipoId", ''::character varying) WITH =, COALESCE("modalidadeId", '-1'::integer) WITH =, COALESCE("fornecedorId", '-1'::integer) WITH =, moeda WITH =, COALESCE(unidade, ''::character varying) WITH =, COALESCE("quantidadeMinima", '-1'::numeric) WITH =, COALESCE("quantidadeMaxima", '-1'::numeric) WITH =, prioridade WITH =, daterange(discovery_iso_to_date(("vigenciaInicio")::text), discovery_iso_to_date(("vigenciaFim")::text), '[]'::text) WITH &&) WHERE (((arquivado = false) AND ("configuracaoFinanceiraItemId" IS NOT NULL)));

-- O Prisma gera @@unique sempre como NULLS DISTINCT. A migration de origem
-- (20260113180000_add_tipo_registro_custo) criou este unique com NULLS NOT
-- DISTINCT de proposito: tipoRegistro e' nullable, e so pode existir UMA linha
-- com tipoRegistro nulo por (processoId, pessoaId, tipoServicoId). Sem isto o
-- baseline fica MAIS FRACO que producao. Substitui o indice gerado acima.
ALTER TABLE "CustoPessoa" DROP CONSTRAINT IF EXISTS "CustoPessoa_processoId_pessoaId_tipoServicoId_tipoRegistro_key";
DROP INDEX IF EXISTS "CustoPessoa_processoId_pessoaId_tipoServicoId_tipoRegistro_key";
ALTER TABLE "CustoPessoa" ADD CONSTRAINT "CustoPessoa_processoId_pessoaId_tipoServicoId_tipoRegistro_key"
  UNIQUE NULLS NOT DISTINCT ("processoId", "pessoaId", "tipoServicoId", "tipoRegistro");
