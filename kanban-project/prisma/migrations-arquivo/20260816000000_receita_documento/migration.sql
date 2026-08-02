-- Aditivo/reversível: documentos financeiros vinculados a uma Receita
-- (contrato, proposta, fatura, comprovante...). Não toca no Documento (genealogia).
CREATE TABLE IF NOT EXISTS "ReceitaDocumento" (
  "id"          SERIAL       PRIMARY KEY,
  "receitaId"   INTEGER      NOT NULL,
  "obrigacaoId" INTEGER,
  "arquivoUrl"  TEXT         NOT NULL,
  "arquivoNome" VARCHAR(255) NOT NULL,
  "tipo"        VARCHAR(60),
  "tamanho"     INTEGER,
  "criadoPorId" INTEGER,
  "criadoEm"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "ReceitaDocumento_receitaId_idx" ON "ReceitaDocumento"("receitaId");

-- FK aditiva (idempotente) — cascade ao remover a Receita.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'ReceitaDocumento_receitaId_fkey'
  ) THEN
    ALTER TABLE "ReceitaDocumento"
      ADD CONSTRAINT "ReceitaDocumento_receitaId_fkey"
      FOREIGN KEY ("receitaId") REFERENCES "Receita"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
