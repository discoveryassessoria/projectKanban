-- Cobrança na base financeira ÚNICA — ADITIVO, backward-compatible, reversível.
CREATE TABLE IF NOT EXISTS "Cobranca" (
  "id" SERIAL PRIMARY KEY,
  "receitaId" INTEGER NOT NULL,
  "processoId" INTEGER NOT NULL,
  "formaPagamentoId" INTEGER,
  "condicaoPagamentoId" INTEGER,
  "contaBancariaId" INTEGER,
  "carteiraId" INTEGER,
  "taxaPagamentoId" INTEGER,
  "gateway" VARCHAR(40),
  "moeda" "Moeda" NOT NULL DEFAULT 'EUR',
  "valorTotal" DECIMAL(12,2) NOT NULL,
  "status" VARCHAR(20) NOT NULL DEFAULT 'ABERTA',
  "condicaoVersao" INTEGER,
  "condicaoCodigo" VARCHAR(60),
  "memoriaCalculo" JSONB,
  "observacoes" TEXT,
  "criadoPorId" INTEGER,
  "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "atualizadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Cobranca_receitaId_fkey" FOREIGN KEY ("receitaId") REFERENCES "Receita"("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "Cobranca_receitaId_idx" ON "Cobranca"("receitaId");
CREATE INDEX IF NOT EXISTS "Cobranca_processoId_idx" ON "Cobranca"("processoId");
CREATE INDEX IF NOT EXISTS "Cobranca_status_idx" ON "Cobranca"("status");

ALTER TABLE "ParcelaFinanceira" ADD COLUMN IF NOT EXISTS "cobrancaId" INTEGER;
ALTER TABLE "EventoFinanceiro"  ADD COLUMN IF NOT EXISTS "cobrancaId" INTEGER;
CREATE INDEX IF NOT EXISTS "ParcelaFinanceira_cobrancaId_idx" ON "ParcelaFinanceira"("cobrancaId");
CREATE INDEX IF NOT EXISTS "EventoFinanceiro_cobrancaId_idx" ON "EventoFinanceiro"("cobrancaId");
DO $$ BEGIN
  ALTER TABLE "ParcelaFinanceira" ADD CONSTRAINT "ParcelaFinanceira_cobrancaId_fkey" FOREIGN KEY ("cobrancaId") REFERENCES "Cobranca"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "EventoFinanceiro" ADD CONSTRAINT "EventoFinanceiro_cobrancaId_fkey" FOREIGN KEY ("cobrancaId") REFERENCES "Cobranca"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
