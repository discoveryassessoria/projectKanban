-- PLANILHA DOCUMENTAL — configuração das colunas econômicas.
-- ADITIVA: cria uma tabela nova. Nenhuma coluna alterada, nenhum dado tocado.
-- A tabela guarda APENAS quais itens canônicos viram coluna, em que ordem e se
-- estão ativos. Preço continua exclusivamente em "TabelaValor".

CREATE TABLE IF NOT EXISTS "PlanilhaDocumentalColuna" (
  "id"              SERIAL       PRIMARY KEY,
  "origem"          VARCHAR(20)  NOT NULL,
  "configId"        INTEGER,
  "tipoDocumentoId" INTEGER,
  "posicao"         INTEGER      NOT NULL DEFAULT 0,
  "ativa"           BOOLEAN      NOT NULL DEFAULT true,
  "rotuloOverride"  VARCHAR(60),
  "criadoEm"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "atualizadoEm"    TIMESTAMP(3) NOT NULL
);

-- Um item do cadastro vira UMA coluna. Nulos não competem entre si no Postgres,
-- então a restrição é naturalmente parcial.
CREATE UNIQUE INDEX IF NOT EXISTS "PlanilhaDocumentalColuna_configId_key"
  ON "PlanilhaDocumentalColuna"("configId");
CREATE UNIQUE INDEX IF NOT EXISTS "PlanilhaDocumentalColuna_tipoDocumentoId_key"
  ON "PlanilhaDocumentalColuna"("tipoDocumentoId");
CREATE INDEX IF NOT EXISTS "PlanilhaDocumentalColuna_ativa_posicao_idx"
  ON "PlanilhaDocumentalColuna"("ativa", "posicao");

ALTER TABLE "PlanilhaDocumentalColuna"
  ADD CONSTRAINT "PlanilhaDocumentalColuna_configId_fkey"
  FOREIGN KEY ("configId") REFERENCES "ProdutoFinanceiro"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PlanilhaDocumentalColuna"
  ADD CONSTRAINT "PlanilhaDocumentalColuna_tipoDocumentoId_fkey"
  FOREIGN KEY ("tipoDocumentoId") REFERENCES "TipoDocumentoCadastro"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Exatamente UMA origem preenchida. A coluna é um serviço OU um documento.
ALTER TABLE "PlanilhaDocumentalColuna"
  ADD CONSTRAINT "PlanilhaDocumentalColuna_origem_unica_chk"
  CHECK (
    ("origem" = 'SERVICO'   AND "configId" IS NOT NULL AND "tipoDocumentoId" IS NULL)
    OR
    ("origem" = 'DOCUMENTO' AND "tipoDocumentoId" IS NOT NULL AND "configId" IS NULL)
  );
