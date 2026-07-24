-- Aditivo/reversível: vincula uma Fatura a uma Receita (nullable).
-- Permite "Emitir fatura" por receita e derivar o alerta "Fatura não emitida".
ALTER TABLE "Fatura" ADD COLUMN IF NOT EXISTS "receitaId" INTEGER;

CREATE INDEX IF NOT EXISTS "Fatura_receitaId_idx" ON "Fatura"("receitaId");

-- FK aditiva (idempotente) — SetNull ao remover a Receita (não apaga a fatura).
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'Fatura_receitaId_fkey'
  ) THEN
    ALTER TABLE "Fatura"
      ADD CONSTRAINT "Fatura_receitaId_fkey"
      FOREIGN KEY ("receitaId") REFERENCES "Receita"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
