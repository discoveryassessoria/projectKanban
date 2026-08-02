-- ============================================================================
-- RECONCILIAÇÃO DAS CONSTRAINTS HISTÓRICAS
--
-- Homologação nasceu de um `db push` do schema.prisma, não da sequência de
-- migrations. O push cria tabelas, colunas e os índices que o Prisma modela —
-- mas NÃO cria CHECK, EXCLUDE nem índice único parcial, que só existem no SQL
-- das migrations. Resultado: produção tinha 6 travas de integridade que
-- homologação não tinha, e o mesmo dado inválido passava lá e era barrado aqui.
--
-- Esta migration reinstala exatamente essas 6, com o MESMO DDL da origem:
--   1. NecessidadeDocumental_sujeito_xor            (CHECK)   — cp3
--   2. CategoriaFinanceira_origem_unica_check       (CHECK)   — categoria_financeira_mestre_fk
--   3. TabelaValor_config_contexto_ativo_key        (UNIQUE parcial) — m_unifica
--   4. TabelaValor_vigencia_sem_sobreposicao_excl   (EXCLUDE) — m_unifica/r17
--   5. uq_cotacao_confidence                        (UNIQUE)  — cambio_confidence
--   6. OperacaoAntecipada_..._targetOperationT_key  (UNIQUE)  — operacao_antecipada
--
-- 100% ADITIVA e IDEMPOTENTE: cada objeto só é criado se ainda não existir, e
-- em produção — onde os 6 já existem — a migration é integralmente no-op.
-- Nenhum DROP, nenhum UPDATE, nenhuma linha tocada. Sem downtime: as tabelas
-- envolvidas são pequenas (catálogo/configuração) e as travas nascem válidas.
--
-- Se algum dado violar uma trava, a migration FALHA em vez de instalar a trava
-- pela metade — é o comportamento correto: a divergência precisa aparecer.
-- ============================================================================

-- Pré-requisitos do EXCLUDE (idempotentes por definição).
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

-- 1) NecessidadeDocumental: o sujeito é pessoa OU união, nunca os dois, nunca nenhum.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'NecessidadeDocumental_sujeito_xor') THEN
    ALTER TABLE "NecessidadeDocumental" ADD CONSTRAINT "NecessidadeDocumental_sujeito_xor"
      CHECK ((("pessoaId" IS NOT NULL)::int + ("uniaoId" IS NOT NULL)::int) = 1);
  END IF;
END $$;

-- 2) CategoriaFinanceira: aponta para NO MÁXIMO um mestre.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CategoriaFinanceira_origem_unica_check') THEN
    ALTER TABLE "CategoriaFinanceira" ADD CONSTRAINT "CategoriaFinanceira_origem_unica_check" CHECK (
      ((CASE WHEN "tipoDocumentoId" IS NOT NULL THEN 1 ELSE 0 END)
     + (CASE WHEN "honorarioId"     IS NOT NULL THEN 1 ELSE 0 END)
     + (CASE WHEN "tipoProcessoId"  IS NOT NULL THEN 1 ELSE 0 END)
     + (CASE WHEN "itemCatalogoId"  IS NOT NULL THEN 1 ELSE 0 END)) <= 1
    );
  END IF;
END $$;

-- 3) Tabela de Preços: um preço por (config × natureza × contexto) ativo.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'TabelaValor_config_contexto_ativo_key') THEN
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
  END IF;
END $$;

-- 4) Tabela de Preços: vigências do mesmo contexto não podem se sobrepor.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'TabelaValor_vigencia_sem_sobreposicao_excl') THEN
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
  END IF;
END $$;

-- 5) Câmbio: idempotência da cotação importada (uma linha por payload/origem/dia).
CREATE UNIQUE INDEX IF NOT EXISTS "uq_cotacao_confidence"
  ON "CotacaoCambio" ("moedaDe", "moedaPara", "dataReferencia", "modalidade", "origem", "payloadHash");

-- 6) Operação Antecipada: uma operação por (processo × necessidade × tipo × documento).
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE schemaname = 'public'
      AND indexname IN (
        'OperacaoAntecipada_processoId_necessidadeId_targetOperationT_key',
        'OperacaoAntecipada_processoId_necessidadeId_targetOperation_key'
      )
  ) THEN
    CREATE UNIQUE INDEX "OperacaoAntecipada_processoId_necessidadeId_targetOperation_key"
      ON "OperacaoAntecipada"("processoId", "necessidadeId", "targetOperationType", "targetTipoDocumentoId");
  END IF;
END $$;
