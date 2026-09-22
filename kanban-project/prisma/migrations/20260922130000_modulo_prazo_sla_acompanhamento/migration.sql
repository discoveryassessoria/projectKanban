-- Mandato "Módulo de Prazos, SLA e Políticas de Acompanhamento" (22/09/2026)
-- ============================================================================
-- ADITIVA e independente. Não toca StepSubtaskDefinition/SubtaskExecution
-- (dois relógios já existentes, congelados 19-20/09/2026) nem nenhum campo já
-- existente de Tarefa — só adiciona colunas novas (nullable) e tabelas novas.
-- Fundação universal para Emissão Documental/Genealogia consumirem na PRÓXIMA
-- entrega; nesta entrega, prova-se só com tarefas sintéticas.

BEGIN;

-- CreateEnum
CREATE TYPE "StatusPoliticaPrazoSla" AS ENUM ('RASCUNHO', 'PUBLICADA', 'INATIVA');
CREATE TYPE "UnidadePrazoSla" AS ENUM ('DIAS_CORRIDOS', 'DIAS_UTEIS');
CREATE TYPE "EstrategiaRetroacaoPrazoSla" AS ENUM ('SOMENTE_NOVAS', 'RECALCULAR_DA_ORIGEM', 'APLICAR_DA_PUBLICACAO', 'MANTER_PRAZO_ATUALIZAR_ACOMPANHAMENTO');

-- AlterTable: Tarefa — colunas novas, todas nullable, zero impacto em linhas existentes
ALTER TABLE "Tarefa" ADD COLUMN     "aguardandoDesde" TIMESTAMP(3),
ADD COLUMN     "origemDaEspera" VARCHAR(20),
ADD COLUMN     "politicaPrazoSlaId" INTEGER,
ADD COLUMN     "politicaPrazoSlaVersaoId" INTEGER,
ADD COLUMN     "prazoBaseCalculoEm" TIMESTAMP(3),
ADD COLUMN     "proximoAcompanhamentoEm" TIMESTAMP(3),
ADD COLUMN     "terceiroResponsavelId" INTEGER;

-- CreateTable
CREATE TABLE "PoliticaPrazoSla" (
    "id" SERIAL NOT NULL,
    "chave" VARCHAR(80) NOT NULL,
    "nome" VARCHAR(160) NOT NULL,
    "descricao" TEXT,
    "status" "StatusPoliticaPrazoSla" NOT NULL DEFAULT 'RASCUNHO',
    "versaoAtual" INTEGER NOT NULL DEFAULT 0,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,
    "criadoPorId" INTEGER,

    CONSTRAINT "PoliticaPrazoSla_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PoliticaPrazoSlaVersao" (
    "id" SERIAL NOT NULL,
    "politicaId" INTEGER NOT NULL,
    "versao" INTEGER NOT NULL,
    "prazoQuantidade" INTEGER NOT NULL,
    "prazoUnidade" "UnidadePrazoSla" NOT NULL,
    "prazoEventoInicialChave" VARCHAR(60) NOT NULL,
    "calendarioChave" VARCHAR(60),
    "tratamentoFimDeSemana" VARCHAR(20) NOT NULL,
    "tratamentoFeriado" VARCHAR(20) NOT NULL,
    "horarioLimite" VARCHAR(5),
    "politicaDataNaoUtil" VARCHAR(20) NOT NULL,
    "riscoAntecedenciaDias" INTEGER NOT NULL,
    "escalonamentoAtivo" BOOLEAN NOT NULL DEFAULT false,
    "escalonamentoPapel" VARCHAR(60),
    "escalonamentoDestinatarioId" INTEGER,
    "lembreteAtrasoRecorrenciaDias" INTEGER,
    "acompanhamentoPrimeiroDias" INTEGER NOT NULL,
    "acompanhamentoPadraoDias" INTEGER NOT NULL,
    "acompanhamentoUnidade" "UnidadePrazoSla" NOT NULL,
    "acompanhamentoPermiteManual" BOOLEAN NOT NULL DEFAULT true,
    "acompanhamentoExigeMotivo" BOOLEAN NOT NULL DEFAULT true,
    "acompanhamentoLimiteSemResposta" INTEGER,
    "acompanhamentoEscalonamentoPapel" VARCHAR(60),
    "esperaTerceiroPadraoAtivo" BOOLEAN NOT NULL DEFAULT false,
    "estrategiaRetroacao" "EstrategiaRetroacaoPrazoSla" NOT NULL,
    "motivoAlteracao" TEXT,
    "publicadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publicadoPorId" INTEGER,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PoliticaPrazoSlaVersao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CalendarioOficial" (
    "id" SERIAL NOT NULL,
    "chave" VARCHAR(60) NOT NULL,
    "nome" VARCHAR(120) NOT NULL,
    "descricao" TEXT,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CalendarioOficial_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeriadoCalendario" (
    "id" SERIAL NOT NULL,
    "calendarioId" INTEGER NOT NULL,
    "data" DATE NOT NULL,
    "nome" VARCHAR(120) NOT NULL,
    "recorrenteAnual" BOOLEAN NOT NULL DEFAULT false,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FeriadoCalendario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventoPrazoSla" (
    "id" SERIAL NOT NULL,
    "tipo" VARCHAR(60) NOT NULL,
    "tarefaId" INTEGER,
    "processoId" INTEGER,
    "politicaId" INTEGER,
    "politicaVersaoId" INTEGER,
    "usuarioId" INTEGER,
    "valorAnterior" JSONB,
    "valorNovo" JSONB,
    "motivo" TEXT,
    "chaveIdempotencia" VARCHAR(200) NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventoPrazoSla_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PoliticaPrazoSla_chave_key" ON "PoliticaPrazoSla"("chave");
CREATE INDEX "PoliticaPrazoSla_status_idx" ON "PoliticaPrazoSla"("status");
CREATE INDEX "PoliticaPrazoSla_ativo_idx" ON "PoliticaPrazoSla"("ativo");
CREATE INDEX "PoliticaPrazoSlaVersao_politicaId_idx" ON "PoliticaPrazoSlaVersao"("politicaId");
CREATE UNIQUE INDEX "PoliticaPrazoSlaVersao_politicaId_versao_key" ON "PoliticaPrazoSlaVersao"("politicaId", "versao");
CREATE UNIQUE INDEX "CalendarioOficial_chave_key" ON "CalendarioOficial"("chave");
CREATE INDEX "CalendarioOficial_ativo_idx" ON "CalendarioOficial"("ativo");
CREATE INDEX "FeriadoCalendario_calendarioId_idx" ON "FeriadoCalendario"("calendarioId");
CREATE UNIQUE INDEX "FeriadoCalendario_calendarioId_data_key" ON "FeriadoCalendario"("calendarioId", "data");
CREATE UNIQUE INDEX "EventoPrazoSla_chaveIdempotencia_key" ON "EventoPrazoSla"("chaveIdempotencia");
CREATE INDEX "EventoPrazoSla_tarefaId_idx" ON "EventoPrazoSla"("tarefaId");
CREATE INDEX "EventoPrazoSla_tipo_idx" ON "EventoPrazoSla"("tipo");
CREATE INDEX "EventoPrazoSla_processoId_idx" ON "EventoPrazoSla"("processoId");
CREATE INDEX "Tarefa_politicaPrazoSlaId_idx" ON "Tarefa"("politicaPrazoSlaId");
CREATE INDEX "Tarefa_politicaPrazoSlaVersaoId_idx" ON "Tarefa"("politicaPrazoSlaVersaoId");
CREATE INDEX "Tarefa_terceiroResponsavelId_idx" ON "Tarefa"("terceiroResponsavelId");
CREATE INDEX "Tarefa_proximoAcompanhamentoEm_idx" ON "Tarefa"("proximoAcompanhamentoEm");

-- AddForeignKey
ALTER TABLE "Tarefa" ADD CONSTRAINT "Tarefa_politicaPrazoSlaId_fkey" FOREIGN KEY ("politicaPrazoSlaId") REFERENCES "PoliticaPrazoSla"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Tarefa" ADD CONSTRAINT "Tarefa_politicaPrazoSlaVersaoId_fkey" FOREIGN KEY ("politicaPrazoSlaVersaoId") REFERENCES "PoliticaPrazoSlaVersao"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Tarefa" ADD CONSTRAINT "Tarefa_terceiroResponsavelId_fkey" FOREIGN KEY ("terceiroResponsavelId") REFERENCES "OrgaoProtocolo"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PoliticaPrazoSlaVersao" ADD CONSTRAINT "PoliticaPrazoSlaVersao_politicaId_fkey" FOREIGN KEY ("politicaId") REFERENCES "PoliticaPrazoSla"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FeriadoCalendario" ADD CONSTRAINT "FeriadoCalendario_calendarioId_fkey" FOREIGN KEY ("calendarioId") REFERENCES "CalendarioOficial"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EventoPrazoSla" ADD CONSTRAINT "EventoPrazoSla_tarefaId_fkey" FOREIGN KEY ("tarefaId") REFERENCES "Tarefa"("id") ON DELETE SET NULL ON UPDATE CASCADE;

COMMIT;
