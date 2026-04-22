-- =========================================================
-- Migration manual: add-recibo-estorno
-- Rodar este SQL no banco Postgres (Neon/Prisma Console)
-- =========================================================

-- 1) Adicionar campos em PagamentoFatura
ALTER TABLE "PagamentoFatura"
  ADD COLUMN "estornado" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "estornadoEm" TIMESTAMP(3),
  ADD COLUMN "estornoMotivo" VARCHAR(200);

-- 2) Criar tabela Recibo
CREATE TABLE "Recibo" (
  "id" SERIAL PRIMARY KEY,
  "processoId" INTEGER NOT NULL,
  "numero" VARCHAR(20) NOT NULL UNIQUE,
  "data" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "valorTotal" DECIMAL(12, 2) NOT NULL,
  "descricao" TEXT NOT NULL,
  "pagadorRequerenteId" INTEGER,
  "pagadorContratanteId" INTEGER,
  "pagadorNome" VARCHAR(200),
  "pdfUrl" TEXT,
  "pdfNome" VARCHAR(200),
  "emitidoPorId" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Recibo_processoId_fkey" FOREIGN KEY ("processoId") REFERENCES "Processo"("id") ON DELETE CASCADE,
  CONSTRAINT "Recibo_pagadorRequerenteId_fkey" FOREIGN KEY ("pagadorRequerenteId") REFERENCES "Requerente"("id") ON DELETE SET NULL,
  CONSTRAINT "Recibo_pagadorContratanteId_fkey" FOREIGN KEY ("pagadorContratanteId") REFERENCES "Contratante"("id") ON DELETE SET NULL,
  CONSTRAINT "Recibo_emitidoPorId_fkey" FOREIGN KEY ("emitidoPorId") REFERENCES "Usuario"("id") ON DELETE SET NULL
);

CREATE INDEX "Recibo_processoId_idx" ON "Recibo"("processoId");
CREATE INDEX "Recibo_numero_idx" ON "Recibo"("numero");
CREATE INDEX "Recibo_pagadorRequerenteId_idx" ON "Recibo"("pagadorRequerenteId");
CREATE INDEX "Recibo_pagadorContratanteId_idx" ON "Recibo"("pagadorContratanteId");

-- 3) Tabela de relação M:N Recibo <-> PagamentoFatura
CREATE TABLE "_ReciboPagamento" (
  "A" INTEGER NOT NULL,
  "B" INTEGER NOT NULL,
  CONSTRAINT "_ReciboPagamento_A_fkey" FOREIGN KEY ("A") REFERENCES "PagamentoFatura"("id") ON DELETE CASCADE,
  CONSTRAINT "_ReciboPagamento_B_fkey" FOREIGN KEY ("B") REFERENCES "Recibo"("id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX "_ReciboPagamento_AB_unique" ON "_ReciboPagamento"("A", "B");
CREATE INDEX "_ReciboPagamento_B_index" ON "_ReciboPagamento"("B");

-- 4) Criar tabela CounterRecibo
CREATE TABLE "CounterRecibo" (
  "processoId" INTEGER PRIMARY KEY,
  "proximoNumero" INTEGER NOT NULL DEFAULT 1,
  "atualizadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CounterRecibo_processoId_fkey" FOREIGN KEY ("processoId") REFERENCES "Processo"("id") ON DELETE CASCADE
);