-- F5 — Vínculo explícito e auditável de Repasse/Reembolso (Custo → Cobrança/Receita do
-- cliente). Tabela NOVA, aditiva/reversível; nenhum dado histórico tocado. Custo e Receita
-- seguem distintos — este é só o elo rastreável, nunca conversão automática.
CREATE TABLE "RepasseCusto" (
    "id" SERIAL NOT NULL,
    "custoObrigacaoId" INTEGER NOT NULL,
    "receitaObrigacaoId" INTEGER,
    "cobrancaId" INTEGER,
    "tipo" VARCHAR(12) NOT NULL,
    "valor" DECIMAL(14,2) NOT NULL,
    "percentual" DECIMAL(6,3),
    "pagadorPessoaId" INTEGER,
    "status" VARCHAR(12) NOT NULL DEFAULT 'ATIVO',
    "motivo" VARCHAR(300),
    "criadoPorId" INTEGER,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RepasseCusto_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "RepasseCusto_custoObrigacaoId_idx" ON "RepasseCusto"("custoObrigacaoId");
CREATE INDEX "RepasseCusto_receitaObrigacaoId_idx" ON "RepasseCusto"("receitaObrigacaoId");
ALTER TABLE "RepasseCusto" ADD CONSTRAINT "RepasseCusto_custoObrigacaoId_fkey" FOREIGN KEY ("custoObrigacaoId") REFERENCES "ObrigacaoEconomica"("id") ON DELETE CASCADE ON UPDATE CASCADE;
