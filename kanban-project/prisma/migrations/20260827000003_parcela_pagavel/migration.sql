-- F5 — Cronograma de PAGÁVEIS (Contas a Pagar). Tabela NOVA, aditiva/reversível; nenhum
-- dado histórico tocado. Guarda só o plano (vencimento+valor); saldo permanece no Ledger.
CREATE TABLE "ParcelaPagavel" (
    "id" SERIAL NOT NULL,
    "obrigacaoId" INTEGER NOT NULL,
    "numero" INTEGER NOT NULL,
    "vencimento" TIMESTAMP(3) NOT NULL,
    "valor" DECIMAL(14,2) NOT NULL,
    "moeda" "Moeda" NOT NULL DEFAULT 'BRL',
    "canceladaEm" TIMESTAMP(3),
    "criadoPorId" INTEGER,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ParcelaPagavel_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ParcelaPagavel_obrigacaoId_numero_key" ON "ParcelaPagavel"("obrigacaoId", "numero");
CREATE INDEX "ParcelaPagavel_obrigacaoId_idx" ON "ParcelaPagavel"("obrigacaoId");
CREATE INDEX "ParcelaPagavel_vencimento_idx" ON "ParcelaPagavel"("vencimento");
ALTER TABLE "ParcelaPagavel" ADD CONSTRAINT "ParcelaPagavel_obrigacaoId_fkey" FOREIGN KEY ("obrigacaoId") REFERENCES "ObrigacaoEconomica"("id") ON DELETE CASCADE ON UPDATE CASCADE;
