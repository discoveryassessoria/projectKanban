-- FINANCEIRO GERAL + CANCELAMENTO/ESTORNO + ORIGEM — migração ADITIVA, NÃO-destrutiva.
-- Nenhum DROP/DELETE. Preserva todos os dados e campos existentes.
--
-- Adiciona ao lançamento canônico do processo (Receita/Custo): origem, natureza do
-- LANÇAMENTO (§1), competência, evento operacional, cancelamento (§10) e estorno
-- (§11, movimento inverso auto-relacionado) com chaves idempotentes (§12). Adiciona
-- origem/vínculo em ContaPagar (§7/§15). Toda coluna é nullable ou tem default seguro.

-- ── Receita (lançamento de RECEITA do processo) ─────────────────────────────
ALTER TABLE "Receita"
  ADD COLUMN IF NOT EXISTS "origemLancamento"   VARCHAR(20)  NOT NULL DEFAULT 'PROCESSO',
  ADD COLUMN IF NOT EXISTS "naturezaLancamento" VARCHAR(10)  NOT NULL DEFAULT 'RECEITA',
  ADD COLUMN IF NOT EXISTS "eventoOperacionalId" VARCHAR(120),
  ADD COLUMN IF NOT EXISTS "dataCompetencia"    TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "canceladoEm"        TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "canceladoMotivo"    VARCHAR(500),
  ADD COLUMN IF NOT EXISTS "canceladoPorId"     INTEGER,
  ADD COLUMN IF NOT EXISTS "canceladoEventoRef" VARCHAR(120),
  ADD COLUMN IF NOT EXISTS "chaveCancelamento"  VARCHAR(220),
  ADD COLUMN IF NOT EXISTS "estornadoEm"        TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "estornoMotivo"      VARCHAR(500),
  ADD COLUMN IF NOT EXISTS "estornoDeId"        INTEGER,
  ADD COLUMN IF NOT EXISTS "chaveEstorno"       VARCHAR(220);

CREATE UNIQUE INDEX IF NOT EXISTS "Receita_chaveCancelamento_key" ON "Receita"("chaveCancelamento");
CREATE UNIQUE INDEX IF NOT EXISTS "Receita_estornoDeId_key"       ON "Receita"("estornoDeId");
CREATE UNIQUE INDEX IF NOT EXISTS "Receita_chaveEstorno_key"      ON "Receita"("chaveEstorno");
CREATE INDEX        IF NOT EXISTS "Receita_origemLancamento_idx"  ON "Receita"("origemLancamento");

DO $$ BEGIN
  ALTER TABLE "Receita" ADD CONSTRAINT "Receita_estornoDeId_fkey"
    FOREIGN KEY ("estornoDeId") REFERENCES "Receita"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── Custo (lançamento de CUSTO do processo) ─────────────────────────────────
ALTER TABLE "Custo"
  ADD COLUMN IF NOT EXISTS "origemLancamento"   VARCHAR(20)  NOT NULL DEFAULT 'PROCESSO',
  ADD COLUMN IF NOT EXISTS "naturezaLancamento" VARCHAR(10)  NOT NULL DEFAULT 'CUSTO',
  ADD COLUMN IF NOT EXISTS "eventoOperacionalId" VARCHAR(120),
  ADD COLUMN IF NOT EXISTS "dataCompetencia"    TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "canceladoEm"        TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "canceladoMotivo"    VARCHAR(500),
  ADD COLUMN IF NOT EXISTS "canceladoPorId"     INTEGER,
  ADD COLUMN IF NOT EXISTS "canceladoEventoRef" VARCHAR(120),
  ADD COLUMN IF NOT EXISTS "chaveCancelamento"  VARCHAR(220),
  ADD COLUMN IF NOT EXISTS "estornadoEm"        TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "estornoMotivo"      VARCHAR(500),
  ADD COLUMN IF NOT EXISTS "estornoDeId"        INTEGER,
  ADD COLUMN IF NOT EXISTS "chaveEstorno"       VARCHAR(220);

CREATE UNIQUE INDEX IF NOT EXISTS "Custo_chaveCancelamento_key" ON "Custo"("chaveCancelamento");
CREATE UNIQUE INDEX IF NOT EXISTS "Custo_estornoDeId_key"       ON "Custo"("estornoDeId");
CREATE UNIQUE INDEX IF NOT EXISTS "Custo_chaveEstorno_key"      ON "Custo"("chaveEstorno");
CREATE INDEX        IF NOT EXISTS "Custo_origemLancamento_idx"  ON "Custo"("origemLancamento");

DO $$ BEGIN
  ALTER TABLE "Custo" ADD CONSTRAINT "Custo_estornoDeId_fkey"
    FOREIGN KEY ("estornoDeId") REFERENCES "Custo"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── ContaPagar (Financeiro Geral corporativo) — origem + vínculo ao Custo ────
ALTER TABLE "ContaPagar"
  ADD COLUMN IF NOT EXISTS "origem"        VARCHAR(20) NOT NULL DEFAULT 'CORPORATIVA',
  ADD COLUMN IF NOT EXISTS "custoOrigemId" INTEGER;

CREATE INDEX IF NOT EXISTS "ContaPagar_origem_idx" ON "ContaPagar"("origem");

-- ── PendenciaFinanceira (§13) — registrar a resolução aplicada ───────────────
ALTER TABLE "PendenciaFinanceira" ADD COLUMN IF NOT EXISTS "resolucao" VARCHAR(300);
