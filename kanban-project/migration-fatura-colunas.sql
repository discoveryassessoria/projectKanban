-- =============================================
-- MIGRATION: Adicionar colunas na tabela Fatura
-- =============================================

-- 1. Criar enum Moeda (se não existir)
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'Moeda') THEN
        CREATE TYPE "Moeda" AS ENUM ('BRL', 'EUR', 'USD');
    END IF;
END $$;

-- 2. Adicionar colunas na tabela Fatura
ALTER TABLE "Fatura" ADD COLUMN IF NOT EXISTS "moeda" "Moeda" DEFAULT 'BRL';
ALTER TABLE "Fatura" ADD COLUMN IF NOT EXISTS "valorOriginal" DECIMAL(10, 2);
ALTER TABLE "Fatura" ADD COLUMN IF NOT EXISTS "cambio" DECIMAL(10, 4);
ALTER TABLE "Fatura" ADD COLUMN IF NOT EXISTS "metodoPagamento" "FormaPagamento";
ALTER TABLE "Fatura" ADD COLUMN IF NOT EXISTS "parcelas" INTEGER DEFAULT 1;
ALTER TABLE "Fatura" ADD COLUMN IF NOT EXISTS "valorParcela" DECIMAL(10, 2);

-- 3. Verificar
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'Fatura' 
ORDER BY ordinal_position;