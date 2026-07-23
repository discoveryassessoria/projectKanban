-- Motor Financeiro V3 · Fase 3 — Conciliação bancária (aditivo, idempotente).
CREATE TABLE IF NOT EXISTS "LancamentoBancario" (
    "id" SERIAL NOT NULL,
    "data" TIMESTAMP(3) NOT NULL,
    "moeda" "Moeda" NOT NULL DEFAULT 'BRL',
    "valorBruto" DECIMAL(14,2) NOT NULL,
    "valorTarifa" DECIMAL(14,2),
    "valorLiquido" DECIMAL(14,2) NOT NULL,
    "identificadorTransacao" VARCHAR(120),
    "contaRecebimentoId" INTEGER,
    "descricao" VARCHAR(300),
    "status" VARCHAR(16) NOT NULL DEFAULT 'INFORMADO',
    "ocorrenciaId" INTEGER,
    "obrigacaoId" INTEGER,
    "divergencia" VARCHAR(200),
    "origem" VARCHAR(20) NOT NULL DEFAULT 'manual',
    "criadoPorId" INTEGER,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LancamentoBancario_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "LancamentoBancario_identificadorTransacao_key" ON "LancamentoBancario"("identificadorTransacao");
CREATE INDEX IF NOT EXISTS "LancamentoBancario_status_idx" ON "LancamentoBancario"("status");
CREATE INDEX IF NOT EXISTS "LancamentoBancario_ocorrenciaId_idx" ON "LancamentoBancario"("ocorrenciaId");
CREATE INDEX IF NOT EXISTS "LancamentoBancario_obrigacaoId_idx" ON "LancamentoBancario"("obrigacaoId");
CREATE INDEX IF NOT EXISTS "LancamentoBancario_data_idx" ON "LancamentoBancario"("data");
