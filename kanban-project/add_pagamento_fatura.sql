-- Migration: add_pagamento_fatura
-- Adiciona tabela PagamentoFatura e remove campos antigos de Fatura

-- 1. Criar tabela PagamentoFatura
CREATE TABLE IF NOT EXISTS "PagamentoFatura" (
    "id" SERIAL PRIMARY KEY,
    "faturaId" INTEGER NOT NULL,
    "valor" DECIMAL(10, 2) NOT NULL,
    "data" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "formaPagamento" "FormaPagamento",
    "comprovanteUrl" TEXT,
    "comprovanteNome" VARCHAR(200),
    "observacao" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
    CONSTRAINT "PagamentoFatura_faturaId_fkey" 
        FOREIGN KEY ("faturaId") 
        REFERENCES "Fatura"("id") 
        ON DELETE CASCADE 
        ON UPDATE CASCADE
);

-- 2. Criar índice
CREATE INDEX IF NOT EXISTS "PagamentoFatura_faturaId_idx" ON "PagamentoFatura"("faturaId");

-- 3. Migrar dados existentes de pagamento para a nova tabela
-- (se tiver faturas já pagas, cria um registro de pagamento para cada)
INSERT INTO "PagamentoFatura" ("faturaId", "valor", "data", "formaPagamento", "comprovanteUrl", "comprovanteNome", "createdAt")
SELECT 
    "id",
    COALESCE("valorPago", "valor"),
    COALESCE("dataPagamento", "createdAt"),
    "formaPagamento",
    "comprovanteUrl",
    "comprovanteNome",
    CURRENT_TIMESTAMP
FROM "Fatura"
WHERE "valorPago" IS NOT NULL AND "valorPago" > 0;

-- 4. Remover colunas antigas da tabela Fatura
ALTER TABLE "Fatura" DROP COLUMN IF EXISTS "dataPagamento";
ALTER TABLE "Fatura" DROP COLUMN IF EXISTS "formaPagamento";
ALTER TABLE "Fatura" DROP COLUMN IF EXISTS "valorPago";
ALTER TABLE "Fatura" DROP COLUMN IF EXISTS "comprovanteUrl";
ALTER TABLE "Fatura" DROP COLUMN IF EXISTS "comprovanteNome";

-- 5. Atualizar faturas com status CANCELADO para que possam ser deletadas
-- (ou converter para PENDENTE se preferir manter)
UPDATE "Fatura" SET "status" = 'PENDENTE' WHERE "status" = 'CANCELADO';

-- 6. Remover CANCELADO do enum (opcional - PostgreSQL não permite remover valores de enum facilmente)
-- Se quiser remover, precisa recriar o enum, o que é mais complexo
-- Por enquanto, apenas não usamos mais o valor CANCELADO

-- Pronto! Depois de rodar, execute:
-- npx prisma generate