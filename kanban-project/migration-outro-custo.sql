-- =========================================================
-- Migration manual: add-outro-custo
-- Rodar este SQL no banco Postgres (Neon/Prisma Console)
-- Adiciona OutroCusto e PagamentoOutroCusto para lançamentos
-- manuais (Honorários Discovery, Advogado, Cartório, etc.)
-- =========================================================

-- 1) Criar enum NaturezaOutroCusto
CREATE TYPE "NaturezaOutroCusto" AS ENUM ('COBRAR', 'REPASSAR');

-- 2) Criar tabela OutroCusto
CREATE TABLE "OutroCusto" (
  "id" SERIAL PRIMARY KEY,
  "processoId" INTEGER NOT NULL,
  "natureza" "NaturezaOutroCusto" NOT NULL,
  "tipo" VARCHAR(100) NOT NULL,
  "descricao" VARCHAR(200) NOT NULL,
  "fornecedor" VARCHAR(150),
  "valor" DECIMAL(12, 2) NOT NULL,
  "moeda" "Moeda" NOT NULL DEFAULT 'BRL',
  "cambio" DECIMAL(10, 4),
  "vencimento" TIMESTAMP(3),
  "interno" BOOLEAN NOT NULL DEFAULT false,
  "repassado" BOOLEAN NOT NULL DEFAULT false,
  "pago" BOOLEAN NOT NULL DEFAULT false,
  "observacao" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OutroCusto_processoId_fkey" FOREIGN KEY ("processoId") REFERENCES "Processo"("id") ON DELETE CASCADE
);

CREATE INDEX "OutroCusto_processoId_idx" ON "OutroCusto"("processoId");
CREATE INDEX "OutroCusto_natureza_idx" ON "OutroCusto"("natureza");
CREATE INDEX "OutroCusto_vencimento_idx" ON "OutroCusto"("vencimento");

-- 3) Criar tabela PagamentoOutroCusto
CREATE TABLE "PagamentoOutroCusto" (
  "id" SERIAL PRIMARY KEY,
  "outroCustoId" INTEGER NOT NULL,
  "valor" DECIMAL(12, 2) NOT NULL,
  "data" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "forma" "FormaPagamento",
  "pagadorTipo" VARCHAR(20),
  "pagadorId" INTEGER,
  "pagadorNome" VARCHAR(200),
  "comprovanteUrl" TEXT,
  "comprovanteNome" VARCHAR(200),
  "observacao" TEXT,
  "estornado" BOOLEAN NOT NULL DEFAULT false,
  "estornadoEm" TIMESTAMP(3),
  "estornoMotivo" VARCHAR(200),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PagamentoOutroCusto_outroCustoId_fkey" FOREIGN KEY ("outroCustoId") REFERENCES "OutroCusto"("id") ON DELETE CASCADE
);

CREATE INDEX "PagamentoOutroCusto_outroCustoId_idx" ON "PagamentoOutroCusto"("outroCustoId");