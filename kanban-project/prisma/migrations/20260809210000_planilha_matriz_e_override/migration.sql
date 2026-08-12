-- PLANILHA DOCUMENTAL É UMA MATRIZ: registro civil na linha, etapa na coluna.
--
-- A coluna deixa de ser "um item do Cadastro Mestre" e passa a ser uma ETAPA
-- com estratégia de resolução. `SERVICO_FIXO` preserva exatamente o
-- comportamento atual (uma Configuração Financeira, igual em toda linha), então
-- toda coluna existente continua valendo sem tocar em nenhuma delas.
--
-- Aditivo: nenhuma coluna é removida, nenhum dado é reescrito.
ALTER TABLE "PlanilhaDocumentalColuna"
  ADD COLUMN IF NOT EXISTS "estrategia" VARCHAR(24) NOT NULL DEFAULT 'SERVICO_FIXO',
  ADD COLUMN IF NOT EXISTS "categoriaItemId" INTEGER;

DO $$ BEGIN
  ALTER TABLE "PlanilhaDocumentalColuna"
    ADD CONSTRAINT "PlanilhaDocumentalColuna_categoriaItemId_fkey"
    FOREIGN KEY ("categoriaItemId") REFERENCES "CategoriaServico"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "PlanilhaDocumentalColuna_estrategia_idx"
  ON "PlanilhaDocumentalColuna"("estrategia");

-- VALOR COMBINADO DA CÉLULA, por processo. Não toca na Tabela de Preços.
CREATE TABLE IF NOT EXISTS "PlanilhaCelulaOverride" (
  "id"              SERIAL PRIMARY KEY,
  "processoId"      INTEGER NOT NULL,
  "pessoaId"        INTEGER NOT NULL,
  "tipoDocumentoId" INTEGER NOT NULL,
  "colunaId"        INTEGER NOT NULL,
  "valor"           DECIMAL(14,2) NOT NULL,
  "moeda"           VARCHAR(3) NOT NULL DEFAULT 'BRL',
  "autorId"         INTEGER,
  "motivo"          VARCHAR(300),
  "criadoEm"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "atualizadoEm"    TIMESTAMP(3) NOT NULL
);

DO $$ BEGIN
  ALTER TABLE "PlanilhaCelulaOverride"
    ADD CONSTRAINT "PlanilhaCelulaOverride_processoId_fkey" FOREIGN KEY ("processoId") REFERENCES "Processo"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    -- Pessoa removida da árvore não pode deixar override somando no total.
    ADD CONSTRAINT "PlanilhaCelulaOverride_pessoaId_fkey" FOREIGN KEY ("pessoaId") REFERENCES "Pessoa"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT "PlanilhaCelulaOverride_tipoDocumentoId_fkey" FOREIGN KEY ("tipoDocumentoId") REFERENCES "TipoDocumentoCadastro"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT "PlanilhaCelulaOverride_colunaId_fkey" FOREIGN KEY ("colunaId") REFERENCES "PlanilhaDocumentalColuna"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT "PlanilhaCelulaOverride_autorId_fkey" FOREIGN KEY ("autorId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- A identidade da célula é a interseção inteira. Sem isto, dois overrides
-- concorrentes para a mesma célula conviveriam e o total dependeria da ordem.
CREATE UNIQUE INDEX IF NOT EXISTS "PlanilhaCelulaOverride_celula_key"
  ON "PlanilhaCelulaOverride"("processoId", "pessoaId", "tipoDocumentoId", "colunaId");
CREATE INDEX IF NOT EXISTS "PlanilhaCelulaOverride_processoId_idx"
  ON "PlanilhaCelulaOverride"("processoId");
