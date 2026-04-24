-- =============================================
-- MIGRATION MANUAL: FaturaDestinatario
-- Executar via: npx prisma db execute --file ./migration-fatura-destinatario.sql
-- =============================================

-- Criar tabela FaturaDestinatario
CREATE TABLE IF NOT EXISTS "FaturaDestinatario" (
    "id" SERIAL PRIMARY KEY,
    "faturaId" INTEGER NOT NULL,
    "requerenteId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
    CONSTRAINT "FaturaDestinatario_faturaId_fkey" 
        FOREIGN KEY ("faturaId") REFERENCES "Fatura"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "FaturaDestinatario_requerenteId_fkey" 
        FOREIGN KEY ("requerenteId") REFERENCES "Requerente"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- Índices
CREATE INDEX IF NOT EXISTS "FaturaDestinatario_faturaId_idx" ON "FaturaDestinatario"("faturaId");
CREATE INDEX IF NOT EXISTS "FaturaDestinatario_requerenteId_idx" ON "FaturaDestinatario"("requerenteId");