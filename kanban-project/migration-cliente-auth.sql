-- Criar tabela ClienteAuth
CREATE TABLE "ClienteAuth" (
    "id" SERIAL PRIMARY KEY,
    "email" VARCHAR(100) NOT NULL,
    "senhaHash" VARCHAR(255) NOT NULL,
    "contratanteId" INTEGER,
    "requerenteId" INTEGER,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "primeiroAcesso" BOOLEAN NOT NULL DEFAULT true,
    "ultimoLogin" TIMESTAMP(3),
    "resetToken" VARCHAR(255),
    "resetTokenExpira" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClienteAuth_contratanteId_fkey" 
        FOREIGN KEY ("contratanteId") REFERENCES "Contratante"("id") ON DELETE CASCADE,
    CONSTRAINT "ClienteAuth_requerenteId_fkey" 
        FOREIGN KEY ("requerenteId") REFERENCES "Requerente"("id") ON DELETE CASCADE
);

-- Índices
CREATE UNIQUE INDEX "ClienteAuth_email_key" ON "ClienteAuth"("email");
CREATE INDEX "ClienteAuth_contratanteId_idx" ON "ClienteAuth"("contratanteId");
CREATE INDEX "ClienteAuth_requerenteId_idx" ON "ClienteAuth"("requerenteId");