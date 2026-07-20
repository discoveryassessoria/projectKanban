-- Código público (OPA-n) da Operação Antecipada — aditivo, nullable p/ backfill seguro, único.
ALTER TABLE "OperacaoAntecipada" ADD COLUMN "publicCode" VARCHAR(20);
CREATE UNIQUE INDEX "OperacaoAntecipada_publicCode_key" ON "OperacaoAntecipada"("publicCode");
