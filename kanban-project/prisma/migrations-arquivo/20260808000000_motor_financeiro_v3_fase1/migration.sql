-- Motor Financeiro V3 — Fase 1 (ADITIVO, idempotente). Ver docs/motor-financeiro-discovery-spec.md
-- Reversível: DROP TABLE das tabelas abaixo + DROP COLUMN Cobranca.obrigacaoId (nenhuma toca o legado).

CREATE TABLE IF NOT EXISTS "ObrigacaoEconomica" (
    "id" SERIAL NOT NULL,
    "codigoOperacional" VARCHAR(40),
    "natureza" VARCHAR(30) NOT NULL,
    "direcao" VARCHAR(12) NOT NULL,
    "processoId" INTEGER,
    "faseId" INTEGER,
    "clienteId" INTEGER,
    "regraFinanceiraId" INTEGER,
    "moedaContratual" "Moeda" NOT NULL DEFAULT 'BRL',
    "moedaContabil" "Moeda" NOT NULL DEFAULT 'BRL',
    "valorContratado" DECIMAL(14,2) NOT NULL,
    "politicaCambialId" INTEGER,
    "politicaDivisao" VARCHAR(20),
    "contaContabilId" INTEGER,
    "centroCustoId" INTEGER,
    "status" VARCHAR(20) NOT NULL DEFAULT 'RASCUNHO',
    "versao" INTEGER NOT NULL DEFAULT 1,
    "substituiId" INTEGER,
    "origemTipo" VARCHAR(20),
    "origemId" INTEGER,
    "observacoes" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "criadoPorId" INTEGER,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ObrigacaoEconomica_pkey" PRIMARY KEY ("id")
);
CREATE TABLE IF NOT EXISTS "LedgerFinanceiro" (
    "id" SERIAL NOT NULL,
    "obrigacaoId" INTEGER NOT NULL,
    "moedaContabil" "Moeda" NOT NULL DEFAULT 'BRL',
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LedgerFinanceiro_pkey" PRIMARY KEY ("id")
);
CREATE TABLE IF NOT EXISTS "LedgerEntry" (
    "id" SERIAL NOT NULL,
    "ledgerId" INTEGER NOT NULL,
    "obrigacaoId" INTEGER NOT NULL,
    "parcelaId" INTEGER,
    "ocorrenciaId" INTEGER,
    "transacaoId" VARCHAR(60) NOT NULL,
    "tipo" VARCHAR(30) NOT NULL,
    "contaContabil" VARCHAR(20) NOT NULL,
    "direcao" VARCHAR(8) NOT NULL,
    "valor" DECIMAL(14,2) NOT NULL,
    "moeda" "Moeda" NOT NULL DEFAULT 'BRL',
    "valorContabil" DECIMAL(14,2) NOT NULL,
    "snapshotCambialId" INTEGER,
    "data" TIMESTAMP(3) NOT NULL,
    "sequencia" INTEGER NOT NULL,
    "estornaEntryId" INTEGER,
    "idempotencyKey" VARCHAR(120),
    "correlacaoId" VARCHAR(60),
    "criadoPorId" INTEGER,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LedgerEntry_pkey" PRIMARY KEY ("id")
);
CREATE TABLE IF NOT EXISTS "PlanoContaFinanceira" (
    "id" SERIAL NOT NULL,
    "codigo" VARCHAR(20) NOT NULL,
    "nome" VARCHAR(120) NOT NULL,
    "tipo" VARCHAR(20) NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlanoContaFinanceira_pkey" PRIMARY KEY ("id")
);
CREATE TABLE IF NOT EXISTS "LedgerOpeningBalance" (
    "id" SERIAL NOT NULL,
    "obrigacaoId" INTEGER NOT NULL,
    "dataCorte" TIMESTAMP(3) NOT NULL,
    "valorAbertura" DECIMAL(14,2) NOT NULL,
    "moeda" "Moeda" NOT NULL DEFAULT 'BRL',
    "transacaoId" VARCHAR(60) NOT NULL,
    "origem" VARCHAR(30) NOT NULL DEFAULT 'backfill-corte',
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LedgerOpeningBalance_pkey" PRIMARY KEY ("id")
);
CREATE TABLE IF NOT EXISTS "OcorrenciaFinanceira" (
    "id" SERIAL NOT NULL,
    "obrigacaoId" INTEGER NOT NULL,
    "cobrancaId" INTEGER,
    "tipo" VARCHAR(30) NOT NULL,
    "valor" DECIMAL(14,2) NOT NULL,
    "moeda" "Moeda" NOT NULL DEFAULT 'BRL',
    "data" TIMESTAMP(3) NOT NULL,
    "formaPagamentoId" INTEGER,
    "origemRecurso" VARCHAR(20),
    "pagadorId" INTEGER,
    "snapshotCambialId" INTEGER,
    "comprovanteUrl" VARCHAR(400),
    "observacao" TEXT,
    "politicaAplicacao" VARCHAR(24),
    "status" VARCHAR(20) NOT NULL DEFAULT 'PENDENTE',
    "estornaId" INTEGER,
    "correlacaoId" VARCHAR(60),
    "idempotencyKey" VARCHAR(120),
    "criadoPorId" INTEGER,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OcorrenciaFinanceira_pkey" PRIMARY KEY ("id")
);
CREATE TABLE IF NOT EXISTS "AplicacaoFinanceira" (
    "id" SERIAL NOT NULL,
    "ocorrenciaId" INTEGER NOT NULL,
    "parcelaId" INTEGER,
    "cobrancaId" INTEGER,
    "valorAplicado" DECIMAL(14,2) NOT NULL,
    "moeda" "Moeda" NOT NULL DEFAULT 'BRL',
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AplicacaoFinanceira_pkey" PRIMARY KEY ("id")
);
CREATE TABLE IF NOT EXISTS "DistribuicaoEconomica" (
    "id" SERIAL NOT NULL,
    "obrigacaoId" INTEGER NOT NULL,
    "modo" VARCHAR(20) NOT NULL DEFAULT 'SEM_DIVISAO',
    "versao" INTEGER NOT NULL DEFAULT 1,
    "arredondamento" VARCHAR(20) NOT NULL DEFAULT 'ULTIMO_ABSORVE',
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DistribuicaoEconomica_pkey" PRIMARY KEY ("id")
);
CREATE TABLE IF NOT EXISTS "ParticipacaoEconomica" (
    "id" SERIAL NOT NULL,
    "distribuicaoId" INTEGER NOT NULL,
    "pessoaId" INTEGER NOT NULL,
    "incluido" BOOLEAN NOT NULL DEFAULT true,
    "percentual" DECIMAL(7,4),
    "valor" DECIMAL(14,2),
    "moeda" "Moeda" NOT NULL DEFAULT 'BRL',
    "ordem" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ParticipacaoEconomica_pkey" PRIMARY KEY ("id")
);
CREATE TABLE IF NOT EXISTS "Pagador" (
    "id" SERIAL NOT NULL,
    "tipo" VARCHAR(12) NOT NULL,
    "pessoaId" INTEGER,
    "parteExternaId" INTEGER,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Pagador_pkey" PRIMARY KEY ("id")
);
CREATE TABLE IF NOT EXISTS "ParteExterna" (
    "id" SERIAL NOT NULL,
    "nome" VARCHAR(160) NOT NULL,
    "documento" VARCHAR(40),
    "tipo" VARCHAR(4),
    "observacao" TEXT,
    "processoId" INTEGER,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ParteExterna_pkey" PRIMARY KEY ("id")
);
CREATE TABLE IF NOT EXISTS "PoliticaCambial" (
    "id" SERIAL NOT NULL,
    "escopo" VARCHAR(12) NOT NULL,
    "tipo" VARCHAR(12) NOT NULL,
    "permiteOverride" BOOLEAN NOT NULL DEFAULT false,
    "fonteDefault" VARCHAR(60),
    "tratamentoDiferenca" VARCHAR(12) NOT NULL DEFAULT 'CONTABIL',
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PoliticaCambial_pkey" PRIMARY KEY ("id")
);
CREATE TABLE IF NOT EXISTS "SnapshotCambial" (
    "id" SERIAL NOT NULL,
    "moedaOrigem" VARCHAR(10) NOT NULL,
    "moedaDestino" VARCHAR(10) NOT NULL,
    "taxa" DECIMAL(14,6) NOT NULL,
    "direcao" VARCHAR(8) NOT NULL,
    "fonte" VARCHAR(60),
    "tipo" VARCHAR(12) NOT NULL,
    "data" TIMESTAMP(3) NOT NULL,
    "usuarioId" INTEGER,
    "justificativa" VARCHAR(300),
    "precisao" INTEGER NOT NULL DEFAULT 6,
    "valorOriginal" DECIMAL(14,2),
    "valorRecebido" DECIMAL(14,2),
    "diferencaCambial" DECIMAL(14,2),
    "tratamentoDiferenca" VARCHAR(12),
    "motivo" VARCHAR(300),
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SnapshotCambial_pkey" PRIMARY KEY ("id")
);
CREATE TABLE IF NOT EXISTS "CreditoFinanceiro" (
    "id" SERIAL NOT NULL,
    "obrigacaoId" INTEGER,
    "pessoaId" INTEGER,
    "origemOcorrenciaId" INTEGER,
    "valor" DECIMAL(14,2) NOT NULL,
    "moeda" "Moeda" NOT NULL DEFAULT 'BRL',
    "destino" VARCHAR(24) NOT NULL,
    "pagoEmNomeDeTerceiros" DECIMAL(14,2),
    "status" VARCHAR(16) NOT NULL DEFAULT 'ABERTO',
    "aprovadoPorId" INTEGER,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CreditoFinanceiro_pkey" PRIMARY KEY ("id")
);
CREATE TABLE IF NOT EXISTS "SaldoProjecao" (
    "id" SERIAL NOT NULL,
    "obrigacaoId" INTEGER NOT NULL,
    "recebidoBruto" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "recebidoLiquido" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "saldo" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "vencido" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "aVencer" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "ultimaSequenciaAplicada" INTEGER NOT NULL DEFAULT 0,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SaldoProjecao_pkey" PRIMARY KEY ("id")
);
CREATE TABLE IF NOT EXISTS "SaldoSnapshot" (
    "id" SERIAL NOT NULL,
    "obrigacaoId" INTEGER NOT NULL,
    "sequenciaAplicada" INTEGER NOT NULL,
    "saldo" DECIMAL(14,2) NOT NULL,
    "recebidoBruto" DECIMAL(14,2) NOT NULL,
    "recebidoLiquido" DECIMAL(14,2) NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SaldoSnapshot_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "ObrigacaoEconomica_processoId_idx" ON "ObrigacaoEconomica"("processoId");
CREATE INDEX IF NOT EXISTS "ObrigacaoEconomica_status_idx" ON "ObrigacaoEconomica"("status");
CREATE INDEX IF NOT EXISTS "ObrigacaoEconomica_natureza_idx" ON "ObrigacaoEconomica"("natureza");
CREATE INDEX IF NOT EXISTS "ObrigacaoEconomica_codigoOperacional_idx" ON "ObrigacaoEconomica"("codigoOperacional");
CREATE UNIQUE INDEX IF NOT EXISTS "ObrigacaoEconomica_origemTipo_origemId_key" ON "ObrigacaoEconomica"("origemTipo", "origemId");
CREATE UNIQUE INDEX IF NOT EXISTS "LedgerFinanceiro_obrigacaoId_key" ON "LedgerFinanceiro"("obrigacaoId");
CREATE UNIQUE INDEX IF NOT EXISTS "LedgerEntry_idempotencyKey_key" ON "LedgerEntry"("idempotencyKey");
CREATE INDEX IF NOT EXISTS "LedgerEntry_ledgerId_sequencia_idx" ON "LedgerEntry"("ledgerId", "sequencia");
CREATE INDEX IF NOT EXISTS "LedgerEntry_transacaoId_idx" ON "LedgerEntry"("transacaoId");
CREATE INDEX IF NOT EXISTS "LedgerEntry_obrigacaoId_data_idx" ON "LedgerEntry"("obrigacaoId", "data");
CREATE INDEX IF NOT EXISTS "LedgerEntry_ocorrenciaId_idx" ON "LedgerEntry"("ocorrenciaId");
CREATE INDEX IF NOT EXISTS "LedgerEntry_contaContabil_data_idx" ON "LedgerEntry"("contaContabil", "data");
CREATE UNIQUE INDEX IF NOT EXISTS "PlanoContaFinanceira_codigo_key" ON "PlanoContaFinanceira"("codigo");
CREATE UNIQUE INDEX IF NOT EXISTS "LedgerOpeningBalance_obrigacaoId_key" ON "LedgerOpeningBalance"("obrigacaoId");
CREATE UNIQUE INDEX IF NOT EXISTS "OcorrenciaFinanceira_idempotencyKey_key" ON "OcorrenciaFinanceira"("idempotencyKey");
CREATE INDEX IF NOT EXISTS "OcorrenciaFinanceira_obrigacaoId_data_idx" ON "OcorrenciaFinanceira"("obrigacaoId", "data");
CREATE INDEX IF NOT EXISTS "OcorrenciaFinanceira_tipo_status_idx" ON "OcorrenciaFinanceira"("tipo", "status");
CREATE INDEX IF NOT EXISTS "AplicacaoFinanceira_ocorrenciaId_idx" ON "AplicacaoFinanceira"("ocorrenciaId");
CREATE INDEX IF NOT EXISTS "AplicacaoFinanceira_parcelaId_idx" ON "AplicacaoFinanceira"("parcelaId");
CREATE INDEX IF NOT EXISTS "DistribuicaoEconomica_obrigacaoId_idx" ON "DistribuicaoEconomica"("obrigacaoId");
CREATE INDEX IF NOT EXISTS "ParticipacaoEconomica_distribuicaoId_idx" ON "ParticipacaoEconomica"("distribuicaoId");
CREATE INDEX IF NOT EXISTS "ParticipacaoEconomica_pessoaId_idx" ON "ParticipacaoEconomica"("pessoaId");
CREATE INDEX IF NOT EXISTS "CreditoFinanceiro_obrigacaoId_idx" ON "CreditoFinanceiro"("obrigacaoId");
CREATE INDEX IF NOT EXISTS "CreditoFinanceiro_pessoaId_idx" ON "CreditoFinanceiro"("pessoaId");
CREATE UNIQUE INDEX IF NOT EXISTS "SaldoProjecao_obrigacaoId_key" ON "SaldoProjecao"("obrigacaoId");
CREATE INDEX IF NOT EXISTS "SaldoSnapshot_obrigacaoId_sequenciaAplicada_idx" ON "SaldoSnapshot"("obrigacaoId", "sequenciaAplicada");

-- Coluna aditiva no legado (não altera comportamento):
ALTER TABLE "Cobranca" ADD COLUMN IF NOT EXISTS "obrigacaoId" INTEGER;
