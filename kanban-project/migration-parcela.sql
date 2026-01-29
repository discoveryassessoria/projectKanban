-- Migration: Adicionar tabela Parcela
-- Execute no banco de dados manualmente

-- 1. Criar a tabela Parcela
CREATE TABLE "Parcela" (
    "id" SERIAL PRIMARY KEY,
    "faturaId" INTEGER NOT NULL,
    "numero" INTEGER NOT NULL,
    "valor" DECIMAL(10, 2) NOT NULL,
    "dataVencimento" TIMESTAMP(3) NOT NULL,
    "pago" BOOLEAN NOT NULL DEFAULT false,
    "dataPagamento" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    -- Foreign key
    CONSTRAINT "Parcela_faturaId_fkey" FOREIGN KEY ("faturaId") 
        REFERENCES "Fatura"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- 2. Criar índices
CREATE INDEX "Parcela_faturaId_idx" ON "Parcela"("faturaId");
CREATE INDEX "Parcela_dataVencimento_idx" ON "Parcela"("dataVencimento");
CREATE INDEX "Parcela_pago_idx" ON "Parcela"("pago");

-- 3. Criar constraint único (faturaId + numero)
CREATE UNIQUE INDEX "Parcela_faturaId_numero_key" ON "Parcela"("faturaId", "numero");

-- 4. Após rodar o SQL, sincronize o Prisma:
-- npx prisma db pull (puxa o schema do banco)
-- ou
-- npx prisma generate (regenera o client)