-- Aditivo/idempotente: razão imutável de movimentos de crédito (append-only).
CREATE TABLE IF NOT EXISTS "CreditoMovimento" (
  "id" SERIAL PRIMARY KEY,
  "creditoId" INTEGER NOT NULL,
  "tipo" VARCHAR(16) NOT NULL,
  "valor" DECIMAL(14,2) NOT NULL,
  "saldoAnterior" DECIMAL(14,2) NOT NULL,
  "saldoPosterior" DECIMAL(14,2) NOT NULL,
  "moeda" "Moeda" NOT NULL DEFAULT 'BRL',
  "obrigacaoOrigemId" INTEGER,
  "obrigacaoDestinoId" INTEGER,
  "cobrancaDestinoId" INTEGER,
  "ocorrenciaId" INTEGER,
  "pagadorId" INTEGER,
  "pessoaId" INTEGER,
  "processoId" INTEGER,
  "receitaId" INTEGER,
  "usuarioId" INTEGER,
  "correlationId" VARCHAR(80),
  "observacao" VARCHAR(300),
  "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "CreditoMovimento_creditoId_idx" ON "CreditoMovimento"("creditoId");
CREATE INDEX IF NOT EXISTS "CreditoMovimento_correlationId_idx" ON "CreditoMovimento"("correlationId");
