-- ============================================================================
-- MRG - MOTOR REGISTRAL GENEALOGICO (migration ADITIVA e RETROCOMPATIVEL)
--
-- Garantias desta migration, verificadas por scripts/mrg-migration-guard.test.ts:
--   · nenhum DROP TABLE / DROP COLUMN / DROP CONSTRAINT / DROP INDEX;
--   · nenhum RENAME, nenhum ALTER COLUMN ... TYPE, nenhum TRUNCATE/DELETE;
--   · a UNICA alteracao em tabela existente e o acrescimo de 4 colunas
--     NULLABLE em "Documento" (transcricao do documento - dominio do Sistema
--     Documental, nao da arvore);
--   · toda instrucao e IDEMPOTENTE (IF NOT EXISTS / DO block), para poder ser
--     reaplicada sem erro em banco que ja recebeu parte dos objetos;
--   · nenhuma tabela nova nasce com NOT NULL sem default sobre dado existente
--     (sao tabelas novas, portanto vazias) - zero downtime, zero backfill.
-- ============================================================================

-- CreateEnum
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE t.typname='EtapaRegistral' AND n.nspname=current_schema()) THEN
    CREATE TYPE "EtapaRegistral" AS ENUM ('RECEBIDO', 'CLASSIFICANDO', 'EXTRAINDO', 'REEXTRAINDO', 'NORMALIZANDO', 'RESOLVENDO_IDENTIDADES', 'CRUZANDO_EVIDENCIAS', 'VALIDANDO', 'REVALIDANDO', 'ANALISANDO_IMPACTO', 'AGUARDANDO_REVISAO', 'APLICADO', 'AUDITADO', 'FALHA_LEITURA', 'DOCUMENTO_INSUFICIENTE', 'DOCUMENTO_CONFLITANTE', 'REPROCESSAMENTO', 'REJEITADO', 'CANCELADO');
  END IF;
END $$;

-- CreateEnum
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE t.typname='StatusLoteRegistral' AND n.nspname=current_schema()) THEN
    CREATE TYPE "StatusLoteRegistral" AS ENUM ('RECEBIDO', 'EM_PROCESSAMENTO', 'AGUARDANDO_REVISAO', 'CONCLUIDO', 'CONCLUIDO_COM_FALHAS', 'CANCELADO');
  END IF;
END $$;

-- CreateEnum
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE t.typname='EstadoFatoRegistral' AND n.nspname=current_schema()) THEN
    CREATE TYPE "EstadoFatoRegistral" AS ENUM ('NAO_INFORMADO', 'INFORMADO_PELO_CLIENTE', 'EXTRAIDO', 'NAO_COMPROVADO', 'INCOMPLETO', 'PROVAVEL', 'CONFIRMADO', 'CONFIRMADO_MULTIPLAS_EVIDENCIAS', 'DIVERGENTE', 'CONFLITANTE', 'EM_REVISAO', 'REJEITADO', 'SUBSTITUIDO_COM_HISTORICO');
  END IF;
END $$;

-- CreateEnum
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE t.typname='CampoRegistral' AND n.nspname=current_schema()) THEN
    CREATE TYPE "CampoRegistral" AS ENUM ('NOME_REGISTRAL', 'NOME_CASADO', 'SEXO', 'DATA_NASCIMENTO', 'LOCAL_NASCIMENTO', 'PAIS_NASCIMENTO', 'FILIACAO_PAI', 'FILIACAO_MAE', 'DATA_CASAMENTO', 'LOCAL_CASAMENTO', 'CONJUGE', 'DATA_OBITO', 'LOCAL_OBITO', 'DATA_BATISMO', 'LOCAL_BATISMO', 'PROFISSAO', 'NACIONALIDADE', 'NATURALIZACAO', 'IDADE_DECLARADA', 'RESIDENCIA_HISTORICA', 'REFERENCIA_REGISTRAL', 'DATA_EMIGRACAO', 'IDENTIDADE_PESSOA', 'IDENTIDADE_PAI', 'IDENTIDADE_MAE', 'VINCULO_ASCENDENTE_TRANSMISSOR');
  END IF;
END $$;

-- CreateEnum
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE t.typname='PapelOcorrencia' AND n.nspname=current_schema()) THEN
    CREATE TYPE "PapelOcorrencia" AS ENUM ('REGISTRADO', 'PAI', 'MAE', 'CONJUGE', 'FILHO', 'AVO_PATERNO', 'AVOA_PATERNA', 'AVO_MATERNO', 'AVOA_MATERNA', 'DECLARANTE', 'TESTEMUNHA', 'OFICIANTE', 'PADRINHO', 'MADRINHA', 'OUTRO');
  END IF;
END $$;

-- CreateEnum
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE t.typname='ClasseCorrespondencia' AND n.nspname=current_schema()) THEN
    CREATE TYPE "ClasseCorrespondencia" AS ENUM ('CORRESPONDENCIA_CONFIRMADA', 'ALTAMENTE_PROVAVEL', 'POSSIVEL', 'REGISTROS_CONFLITANTES', 'PESSOAS_DISTINTAS');
  END IF;
END $$;

-- CreateEnum
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE t.typname='TipoPropostaRegistral' AND n.nspname=current_schema()) THEN
    CREATE TYPE "TipoPropostaRegistral" AS ENUM ('CONFIRMAR_DADO', 'COMPLETAR_DADO', 'CORRIGIR_DADO', 'ADICIONAR_NOME_ALTERNATIVO', 'CRIAR_PESSOA', 'VINCULAR_PESSOA_EXISTENTE', 'CRIAR_RELACIONAMENTO', 'CORRIGIR_RELACIONAMENTO', 'REMOVER_RELACIONAMENTO', 'MESCLAR_PESSOAS', 'SEPARAR_PESSOAS', 'SATISFAZER_NECESSIDADE', 'REABRIR_NECESSIDADE', 'CRIAR_NECESSIDADE', 'MARCAR_DOCUMENTO_DIVERGENTE', 'SOLICITAR_RETIFICACAO');
  END IF;
END $$;

-- CreateEnum
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE t.typname='CriticidadeRegistral' AND n.nspname=current_schema()) THEN
    CREATE TYPE "CriticidadeRegistral" AS ENUM ('AUTOMATICA', 'APROVACAO_HUMANA', 'BLOQUEIO');
  END IF;
END $$;

-- CreateEnum
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE t.typname='StatusPropostaRegistral' AND n.nspname=current_schema()) THEN
    CREATE TYPE "StatusPropostaRegistral" AS ENUM ('PENDENTE', 'APROVADA', 'REJEITADA', 'ADIADA', 'APLICADA', 'REVERTIDA', 'ABORTADA');
  END IF;
END $$;

-- CreateEnum
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE t.typname='SeveridadeRegistral' AND n.nspname=current_schema()) THEN
    CREATE TYPE "SeveridadeRegistral" AS ENUM ('CRITICO', 'ALTO', 'MEDIO', 'BAIXO', 'INFO');
  END IF;
END $$;

-- CreateEnum
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE t.typname='StatusConflitoRegistral' AND n.nspname=current_schema()) THEN
    CREATE TYPE "StatusConflitoRegistral" AS ENUM ('ABERTO', 'EM_REVISAO', 'RESOLVIDO', 'DESCARTADO');
  END IF;
END $$;

-- CreateEnum
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE t.typname='ResultadoLinhagemRegistral' AND n.nspname=current_schema()) THEN
    CREATE TYPE "ResultadoLinhagemRegistral" AS ENUM ('LINHA_COMPLETA_COMPROVADA', 'LINHA_COMPLETA_COM_PENDENCIAS', 'LINHA_ESTRUTURAL_INCOMPLETA', 'LINHA_CONFLITANTE', 'ASCENDENTE_ELEGIVEL_NAO_IDENTIFICADO', 'REVISAO_OBRIGATORIA');
  END IF;
END $$;

-- AlterTable
ALTER TABLE "Documento" ADD COLUMN IF NOT EXISTS     "transcricaoEm" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS     "transcricaoFonte" VARCHAR(40),
ADD COLUMN IF NOT EXISTS     "transcricaoPaginas" JSONB,
ADD COLUMN IF NOT EXISTS     "transcricaoTexto" TEXT;

-- CreateTable
CREATE TABLE IF NOT EXISTS "LoteRegistral" (
    "id" SERIAL NOT NULL,
    "processoId" INTEGER NOT NULL,
    "arvoreId" INTEGER,
    "status" "StatusLoteRegistral" NOT NULL DEFAULT 'RECEBIDO',
    "correlationId" VARCHAR(60) NOT NULL,
    "versaoMotor" VARCHAR(20) NOT NULL,
    "totalDocumentos" INTEGER NOT NULL DEFAULT 0,
    "processados" INTEGER NOT NULL DEFAULT 0,
    "falhos" INTEGER NOT NULL DEFAULT 0,
    "aguardando" INTEGER NOT NULL DEFAULT 0,
    "pessoasCriadas" INTEGER NOT NULL DEFAULT 0,
    "vinculosCriados" INTEGER NOT NULL DEFAULT 0,
    "evidenciasCriadas" INTEGER NOT NULL DEFAULT 0,
    "propostasCriadas" INTEGER NOT NULL DEFAULT 0,
    "conflitosAbertos" INTEGER NOT NULL DEFAULT 0,
    "metricas" JSONB,
    "resumo" TEXT,
    "criadoPorId" INTEGER,
    "chaveIdempotencia" VARCHAR(200) NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "iniciadoEm" TIMESTAMP(3),
    "finalizadoEm" TIMESTAMP(3),
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LoteRegistral_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "ExecucaoRegistral" (
    "id" SERIAL NOT NULL,
    "loteId" INTEGER NOT NULL,
    "documentoId" INTEGER NOT NULL,
    "necessidadeId" INTEGER,
    "etapa" "EtapaRegistral" NOT NULL DEFAULT 'RECEBIDO',
    "tipoDetectado" VARCHAR(60),
    "confiancaTipo" DOUBLE PRECISION,
    "versaoExtrator" VARCHAR(20) NOT NULL,
    "fonteTexto" VARCHAR(30),
    "tentativas" INTEGER NOT NULL DEFAULT 0,
    "proximaEm" TIMESTAMP(3),
    "reservadoEm" TIMESTAMP(3),
    "erro" TEXT,
    "ocorrenciasDetectadas" INTEGER NOT NULL DEFAULT 0,
    "camposExtraidos" INTEGER NOT NULL DEFAULT 0,
    "camposDivergentes" INTEGER NOT NULL DEFAULT 0,
    "evidenciasCriadas" INTEGER NOT NULL DEFAULT 0,
    "correlationId" VARCHAR(60) NOT NULL,
    "chaveIdempotencia" VARCHAR(200) NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,
    "finalizadoEm" TIMESTAMP(3),

    CONSTRAINT "ExecucaoRegistral_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "EtapaExecucaoRegistral" (
    "id" SERIAL NOT NULL,
    "execucaoId" INTEGER NOT NULL,
    "etapa" "EtapaRegistral" NOT NULL,
    "ok" BOOLEAN NOT NULL,
    "mensagem" VARCHAR(500),
    "duracaoMs" INTEGER,
    "tentativa" INTEGER NOT NULL DEFAULT 1,
    "dados" JSONB,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EtapaExecucaoRegistral_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "OcorrenciaDocumental" (
    "id" SERIAL NOT NULL,
    "execucaoId" INTEGER NOT NULL,
    "documentoId" INTEGER NOT NULL,
    "papel" "PapelOcorrencia" NOT NULL,
    "nomeBruto" VARCHAR(300) NOT NULL,
    "nomeNormalizado" VARCHAR(300) NOT NULL,
    "chaveFonetica" VARCHAR(80),
    "sexoInferido" VARCHAR(10),
    "atributos" JSONB,
    "pessoaResolvidaId" INTEGER,
    "classe" "ClasseCorrespondencia",
    "scoreIdentidade" DOUBLE PRECISION,
    "resolvidaAutomaticamente" BOOLEAN NOT NULL DEFAULT false,
    "chaveIdempotencia" VARCHAR(200) NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OcorrenciaDocumental_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "FatoRegistral" (
    "id" SERIAL NOT NULL,
    "pessoaId" INTEGER,
    "uniaoId" INTEGER,
    "campo" "CampoRegistral" NOT NULL,
    "valorBruto" VARCHAR(400),
    "valorNormalizado" VARCHAR(400),
    "valorData" TIMESTAMP(3),
    "valorPessoaId" INTEGER,
    "estado" "EstadoFatoRegistral" NOT NULL DEFAULT 'NAO_INFORMADO',
    "confianca" VARCHAR(12) NOT NULL,
    "origem" VARCHAR(16) NOT NULL,
    "responsavelId" INTEGER,
    "afirmadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "justificativa" VARCHAR(500),
    "regraAplicada" VARCHAR(80),
    "totalEvidencias" INTEGER NOT NULL DEFAULT 0,
    "evidenciasFavoraveis" INTEGER NOT NULL DEFAULT 0,
    "evidenciasContrarias" INTEGER NOT NULL DEFAULT 0,
    "versao" INTEGER NOT NULL DEFAULT 1,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "supersedidoPorId" INTEGER,
    "chaveIdempotencia" VARCHAR(200) NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FatoRegistral_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "EvidenciaRegistral" (
    "id" SERIAL NOT NULL,
    "execucaoId" INTEGER,
    "documentoId" INTEGER NOT NULL,
    "itemCatalogoId" INTEGER,
    "necessidadeId" INTEGER,
    "ocorrenciaId" INTEGER,
    "fatoId" INTEGER,
    "pessoaId" INTEGER,
    "uniaoId" INTEGER,
    "campo" "CampoRegistral" NOT NULL,
    "pagina" INTEGER,
    "regiao" VARCHAR(60),
    "trechoTexto" VARCHAR(600),
    "valorBruto" VARCHAR(400),
    "valorNormalizado" VARCHAR(400),
    "metodoExtracao" VARCHAR(40) NOT NULL,
    "versaoProcessamento" VARCHAR(20) NOT NULL,
    "confiancaExtracao" DOUBLE PRECISION NOT NULL,
    "confiancaAssociacao" DOUBLE PRECISION NOT NULL,
    "regraAplicada" VARCHAR(80),
    "favoravel" BOOLEAN NOT NULL DEFAULT true,
    "chaveIdempotencia" VARCHAR(200) NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EvidenciaRegistral_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "CorrespondenciaIdentidade" (
    "id" SERIAL NOT NULL,
    "ocorrenciaId" INTEGER NOT NULL,
    "pessoaId" INTEGER NOT NULL,
    "classe" "ClasseCorrespondencia" NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "evidencias" JSONB NOT NULL,
    "decisao" VARCHAR(12),
    "decididoPorId" INTEGER,
    "decididoEm" TIMESTAMP(3),
    "decisaoDedupId" INTEGER,
    "chaveIdempotencia" VARCHAR(200) NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CorrespondenciaIdentidade_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "PropostaReconciliacao" (
    "id" SERIAL NOT NULL,
    "processoId" INTEGER NOT NULL,
    "arvoreId" INTEGER,
    "loteId" INTEGER,
    "execucaoId" INTEGER,
    "tipo" "TipoPropostaRegistral" NOT NULL,
    "criticidade" "CriticidadeRegistral" NOT NULL,
    "status" "StatusPropostaRegistral" NOT NULL DEFAULT 'PENDENTE',
    "entidadeAlvo" VARCHAR(20) NOT NULL,
    "alvoId" INTEGER,
    "campo" "CampoRegistral",
    "fatoId" INTEGER,
    "valorAtual" VARCHAR(400),
    "valorProposto" VARCHAR(400),
    "origemValorAtual" VARCHAR(120),
    "origemValorProposto" VARCHAR(120),
    "evidenciasFavoraveis" JSONB NOT NULL,
    "evidenciasContrarias" JSONB NOT NULL,
    "confianca" DOUBLE PRECISION NOT NULL,
    "justificativa" TEXT NOT NULL,
    "regraAplicada" VARCHAR(80) NOT NULL,
    "recomendacao" VARCHAR(300),
    "risco" "SeveridadeRegistral" NOT NULL DEFAULT 'BAIXO',
    "operacao" JSONB NOT NULL,
    "pessoasAfetadas" JSONB,
    "vinculosAfetados" JSONB,
    "documentosAfetados" JSONB,
    "processosAfetados" JSONB,
    "necessidadesAfetadas" JSONB,
    "aplicavelAutomaticamente" BOOLEAN NOT NULL DEFAULT false,
    "decididoPorId" INTEGER,
    "decididoEm" TIMESTAMP(3),
    "decisaoNota" VARCHAR(500),
    "aplicadoEm" TIMESTAMP(3),
    "revertidoEm" TIMESTAMP(3),
    "revertidaPorId" INTEGER,
    "motivoAbortoRevalidacao" TEXT,
    "versaoArvoreAntes" INTEGER,
    "versaoArvoreDepois" INTEGER,
    "correlationId" VARCHAR(60) NOT NULL,
    "chaveIdempotencia" VARCHAR(200) NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PropostaReconciliacao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "ConflitoRegistral" (
    "id" SERIAL NOT NULL,
    "processoId" INTEGER NOT NULL,
    "arvoreId" INTEGER,
    "loteId" INTEGER,
    "execucaoId" INTEGER,
    "codigo" VARCHAR(60) NOT NULL,
    "severidade" "SeveridadeRegistral" NOT NULL,
    "status" "StatusConflitoRegistral" NOT NULL DEFAULT 'ABERTO',
    "campo" "CampoRegistral",
    "pessoaId" INTEGER,
    "uniaoId" INTEGER,
    "descricao" VARCHAR(300) NOT NULL,
    "explicacao" TEXT NOT NULL,
    "acaoSugerida" VARCHAR(300),
    "evidencias" JSONB NOT NULL,
    "documentoIds" JSONB,
    "propostaId" INTEGER,
    "resolvidoPorId" INTEGER,
    "resolvidoEm" TIMESTAMP(3),
    "resolucaoNota" VARCHAR(500),
    "chaveIdempotencia" VARCHAR(200) NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConflitoRegistral_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "ImpactoAplicacaoRegistral" (
    "id" SERIAL NOT NULL,
    "propostaId" INTEGER NOT NULL,
    "calculadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "momento" VARCHAR(10) NOT NULL,
    "pessoasAfetadas" INTEGER NOT NULL DEFAULT 0,
    "arvoresAfetadas" INTEGER NOT NULL DEFAULT 0,
    "requerentesAfetados" INTEGER NOT NULL DEFAULT 0,
    "processosAfetados" INTEGER NOT NULL DEFAULT 0,
    "vinculosAlterados" INTEGER NOT NULL DEFAULT 0,
    "documentosRelacionados" INTEGER NOT NULL DEFAULT 0,
    "necessidadesRecalculadas" INTEGER NOT NULL DEFAULT 0,
    "inconsistenciasCriadas" INTEGER NOT NULL DEFAULT 0,
    "inconsistenciasResolvidas" INTEGER NOT NULL DEFAULT 0,
    "linhaAntes" JSONB,
    "linhaDepois" JSONB,
    "elegibilidadeAntes" "ResultadoLinhagemRegistral",
    "elegibilidadeDepois" "ResultadoLinhagemRegistral",
    "riscoDuplicidade" "SeveridadeRegistral" NOT NULL DEFAULT 'INFO',
    "riscoDocumental" "SeveridadeRegistral" NOT NULL DEFAULT 'INFO',
    "riscoOperacional" "SeveridadeRegistral" NOT NULL DEFAULT 'INFO',
    "bloqueado" BOOLEAN NOT NULL DEFAULT false,
    "motivoBloqueio" TEXT,
    "detalhes" JSONB,
    "chaveIdempotencia" VARCHAR(200) NOT NULL,

    CONSTRAINT "ImpactoAplicacaoRegistral_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "DecisaoRevisaoRegistral" (
    "id" SERIAL NOT NULL,
    "propostaId" INTEGER,
    "conflitoId" INTEGER,
    "decisao" VARCHAR(24) NOT NULL,
    "motivo" VARCHAR(500) NOT NULL,
    "permissao" VARCHAR(60) NOT NULL,
    "responsavelId" INTEGER,
    "correlationId" VARCHAR(60),
    "chaveIdempotencia" VARCHAR(200) NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DecisaoRevisaoRegistral_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "VersaoGenealogica" (
    "id" SERIAL NOT NULL,
    "arvoreId" INTEGER NOT NULL,
    "versao" INTEGER NOT NULL,
    "motivo" VARCHAR(200) NOT NULL,
    "snapshot" JSONB NOT NULL,
    "hash" VARCHAR(64) NOT NULL,
    "propostaId" INTEGER,
    "correlationId" VARCHAR(60),
    "criadoPorId" INTEGER,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VersaoGenealogica_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "MetricaRegistral" (
    "id" SERIAL NOT NULL,
    "chave" VARCHAR(60) NOT NULL,
    "escopo" VARCHAR(40) NOT NULL,
    "janelaInicio" TIMESTAMP(3) NOT NULL,
    "valor" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "amostras" INTEGER NOT NULL DEFAULT 0,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MetricaRegistral_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "LoteRegistral_chaveIdempotencia_key" ON "LoteRegistral"("chaveIdempotencia");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "LoteRegistral_processoId_status_idx" ON "LoteRegistral"("processoId", "status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "LoteRegistral_correlationId_idx" ON "LoteRegistral"("correlationId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "LoteRegistral_criadoEm_idx" ON "LoteRegistral"("criadoEm");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "ExecucaoRegistral_chaveIdempotencia_key" ON "ExecucaoRegistral"("chaveIdempotencia");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ExecucaoRegistral_loteId_etapa_idx" ON "ExecucaoRegistral"("loteId", "etapa");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ExecucaoRegistral_documentoId_idx" ON "ExecucaoRegistral"("documentoId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ExecucaoRegistral_etapa_proximaEm_idx" ON "ExecucaoRegistral"("etapa", "proximaEm");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ExecucaoRegistral_correlationId_idx" ON "ExecucaoRegistral"("correlationId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "EtapaExecucaoRegistral_execucaoId_criadoEm_idx" ON "EtapaExecucaoRegistral"("execucaoId", "criadoEm");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "EtapaExecucaoRegistral_etapa_idx" ON "EtapaExecucaoRegistral"("etapa");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "OcorrenciaDocumental_chaveIdempotencia_key" ON "OcorrenciaDocumental"("chaveIdempotencia");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "OcorrenciaDocumental_execucaoId_idx" ON "OcorrenciaDocumental"("execucaoId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "OcorrenciaDocumental_documentoId_papel_idx" ON "OcorrenciaDocumental"("documentoId", "papel");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "OcorrenciaDocumental_chaveFonetica_idx" ON "OcorrenciaDocumental"("chaveFonetica");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "OcorrenciaDocumental_pessoaResolvidaId_idx" ON "OcorrenciaDocumental"("pessoaResolvidaId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "FatoRegistral_supersedidoPorId_key" ON "FatoRegistral"("supersedidoPorId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "FatoRegistral_chaveIdempotencia_key" ON "FatoRegistral"("chaveIdempotencia");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "FatoRegistral_pessoaId_campo_ativo_idx" ON "FatoRegistral"("pessoaId", "campo", "ativo");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "FatoRegistral_uniaoId_campo_ativo_idx" ON "FatoRegistral"("uniaoId", "campo", "ativo");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "FatoRegistral_estado_idx" ON "FatoRegistral"("estado");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "FatoRegistral_campo_idx" ON "FatoRegistral"("campo");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "EvidenciaRegistral_chaveIdempotencia_key" ON "EvidenciaRegistral"("chaveIdempotencia");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "EvidenciaRegistral_documentoId_campo_idx" ON "EvidenciaRegistral"("documentoId", "campo");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "EvidenciaRegistral_fatoId_idx" ON "EvidenciaRegistral"("fatoId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "EvidenciaRegistral_ocorrenciaId_idx" ON "EvidenciaRegistral"("ocorrenciaId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "EvidenciaRegistral_pessoaId_campo_idx" ON "EvidenciaRegistral"("pessoaId", "campo");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "EvidenciaRegistral_necessidadeId_idx" ON "EvidenciaRegistral"("necessidadeId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "CorrespondenciaIdentidade_chaveIdempotencia_key" ON "CorrespondenciaIdentidade"("chaveIdempotencia");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "CorrespondenciaIdentidade_ocorrenciaId_classe_idx" ON "CorrespondenciaIdentidade"("ocorrenciaId", "classe");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "CorrespondenciaIdentidade_pessoaId_idx" ON "CorrespondenciaIdentidade"("pessoaId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "CorrespondenciaIdentidade_score_idx" ON "CorrespondenciaIdentidade"("score");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "PropostaReconciliacao_chaveIdempotencia_key" ON "PropostaReconciliacao"("chaveIdempotencia");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "PropostaReconciliacao_processoId_status_idx" ON "PropostaReconciliacao"("processoId", "status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "PropostaReconciliacao_loteId_idx" ON "PropostaReconciliacao"("loteId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "PropostaReconciliacao_tipo_status_idx" ON "PropostaReconciliacao"("tipo", "status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "PropostaReconciliacao_criticidade_status_idx" ON "PropostaReconciliacao"("criticidade", "status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "PropostaReconciliacao_correlationId_idx" ON "PropostaReconciliacao"("correlationId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "ConflitoRegistral_chaveIdempotencia_key" ON "ConflitoRegistral"("chaveIdempotencia");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ConflitoRegistral_processoId_status_idx" ON "ConflitoRegistral"("processoId", "status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ConflitoRegistral_severidade_status_idx" ON "ConflitoRegistral"("severidade", "status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ConflitoRegistral_codigo_idx" ON "ConflitoRegistral"("codigo");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ConflitoRegistral_pessoaId_idx" ON "ConflitoRegistral"("pessoaId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "ImpactoAplicacaoRegistral_chaveIdempotencia_key" ON "ImpactoAplicacaoRegistral"("chaveIdempotencia");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ImpactoAplicacaoRegistral_propostaId_momento_idx" ON "ImpactoAplicacaoRegistral"("propostaId", "momento");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ImpactoAplicacaoRegistral_bloqueado_idx" ON "ImpactoAplicacaoRegistral"("bloqueado");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "DecisaoRevisaoRegistral_chaveIdempotencia_key" ON "DecisaoRevisaoRegistral"("chaveIdempotencia");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "DecisaoRevisaoRegistral_propostaId_idx" ON "DecisaoRevisaoRegistral"("propostaId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "DecisaoRevisaoRegistral_conflitoId_idx" ON "DecisaoRevisaoRegistral"("conflitoId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "DecisaoRevisaoRegistral_responsavelId_idx" ON "DecisaoRevisaoRegistral"("responsavelId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "DecisaoRevisaoRegistral_criadoEm_idx" ON "DecisaoRevisaoRegistral"("criadoEm");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "VersaoGenealogica_arvoreId_criadoEm_idx" ON "VersaoGenealogica"("arvoreId", "criadoEm");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "VersaoGenealogica_hash_idx" ON "VersaoGenealogica"("hash");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "VersaoGenealogica_arvoreId_versao_key" ON "VersaoGenealogica"("arvoreId", "versao");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "MetricaRegistral_chave_janelaInicio_idx" ON "MetricaRegistral"("chave", "janelaInicio");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "MetricaRegistral_chave_escopo_janelaInicio_key" ON "MetricaRegistral"("chave", "escopo", "janelaInicio");

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='LoteRegistral_processoId_fkey') THEN
    ALTER TABLE "LoteRegistral" ADD CONSTRAINT "LoteRegistral_processoId_fkey" FOREIGN KEY ("processoId") REFERENCES "Processo"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='LoteRegistral_arvoreId_fkey') THEN
    ALTER TABLE "LoteRegistral" ADD CONSTRAINT "LoteRegistral_arvoreId_fkey" FOREIGN KEY ("arvoreId") REFERENCES "Arvore"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='LoteRegistral_criadoPorId_fkey') THEN
    ALTER TABLE "LoteRegistral" ADD CONSTRAINT "LoteRegistral_criadoPorId_fkey" FOREIGN KEY ("criadoPorId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='ExecucaoRegistral_loteId_fkey') THEN
    ALTER TABLE "ExecucaoRegistral" ADD CONSTRAINT "ExecucaoRegistral_loteId_fkey" FOREIGN KEY ("loteId") REFERENCES "LoteRegistral"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='ExecucaoRegistral_documentoId_fkey') THEN
    ALTER TABLE "ExecucaoRegistral" ADD CONSTRAINT "ExecucaoRegistral_documentoId_fkey" FOREIGN KEY ("documentoId") REFERENCES "Documento"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='ExecucaoRegistral_necessidadeId_fkey') THEN
    ALTER TABLE "ExecucaoRegistral" ADD CONSTRAINT "ExecucaoRegistral_necessidadeId_fkey" FOREIGN KEY ("necessidadeId") REFERENCES "NecessidadeDocumental"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='EtapaExecucaoRegistral_execucaoId_fkey') THEN
    ALTER TABLE "EtapaExecucaoRegistral" ADD CONSTRAINT "EtapaExecucaoRegistral_execucaoId_fkey" FOREIGN KEY ("execucaoId") REFERENCES "ExecucaoRegistral"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='OcorrenciaDocumental_execucaoId_fkey') THEN
    ALTER TABLE "OcorrenciaDocumental" ADD CONSTRAINT "OcorrenciaDocumental_execucaoId_fkey" FOREIGN KEY ("execucaoId") REFERENCES "ExecucaoRegistral"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='OcorrenciaDocumental_documentoId_fkey') THEN
    ALTER TABLE "OcorrenciaDocumental" ADD CONSTRAINT "OcorrenciaDocumental_documentoId_fkey" FOREIGN KEY ("documentoId") REFERENCES "Documento"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='OcorrenciaDocumental_pessoaResolvidaId_fkey') THEN
    ALTER TABLE "OcorrenciaDocumental" ADD CONSTRAINT "OcorrenciaDocumental_pessoaResolvidaId_fkey" FOREIGN KEY ("pessoaResolvidaId") REFERENCES "Pessoa"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='FatoRegistral_pessoaId_fkey') THEN
    ALTER TABLE "FatoRegistral" ADD CONSTRAINT "FatoRegistral_pessoaId_fkey" FOREIGN KEY ("pessoaId") REFERENCES "Pessoa"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='FatoRegistral_uniaoId_fkey') THEN
    ALTER TABLE "FatoRegistral" ADD CONSTRAINT "FatoRegistral_uniaoId_fkey" FOREIGN KEY ("uniaoId") REFERENCES "Uniao"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='FatoRegistral_responsavelId_fkey') THEN
    ALTER TABLE "FatoRegistral" ADD CONSTRAINT "FatoRegistral_responsavelId_fkey" FOREIGN KEY ("responsavelId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='FatoRegistral_supersedidoPorId_fkey') THEN
    ALTER TABLE "FatoRegistral" ADD CONSTRAINT "FatoRegistral_supersedidoPorId_fkey" FOREIGN KEY ("supersedidoPorId") REFERENCES "FatoRegistral"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='EvidenciaRegistral_execucaoId_fkey') THEN
    ALTER TABLE "EvidenciaRegistral" ADD CONSTRAINT "EvidenciaRegistral_execucaoId_fkey" FOREIGN KEY ("execucaoId") REFERENCES "ExecucaoRegistral"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='EvidenciaRegistral_documentoId_fkey') THEN
    ALTER TABLE "EvidenciaRegistral" ADD CONSTRAINT "EvidenciaRegistral_documentoId_fkey" FOREIGN KEY ("documentoId") REFERENCES "Documento"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='EvidenciaRegistral_itemCatalogoId_fkey') THEN
    ALTER TABLE "EvidenciaRegistral" ADD CONSTRAINT "EvidenciaRegistral_itemCatalogoId_fkey" FOREIGN KEY ("itemCatalogoId") REFERENCES "ItemCatalogo"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='EvidenciaRegistral_necessidadeId_fkey') THEN
    ALTER TABLE "EvidenciaRegistral" ADD CONSTRAINT "EvidenciaRegistral_necessidadeId_fkey" FOREIGN KEY ("necessidadeId") REFERENCES "NecessidadeDocumental"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='EvidenciaRegistral_ocorrenciaId_fkey') THEN
    ALTER TABLE "EvidenciaRegistral" ADD CONSTRAINT "EvidenciaRegistral_ocorrenciaId_fkey" FOREIGN KEY ("ocorrenciaId") REFERENCES "OcorrenciaDocumental"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='EvidenciaRegistral_fatoId_fkey') THEN
    ALTER TABLE "EvidenciaRegistral" ADD CONSTRAINT "EvidenciaRegistral_fatoId_fkey" FOREIGN KEY ("fatoId") REFERENCES "FatoRegistral"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='EvidenciaRegistral_pessoaId_fkey') THEN
    ALTER TABLE "EvidenciaRegistral" ADD CONSTRAINT "EvidenciaRegistral_pessoaId_fkey" FOREIGN KEY ("pessoaId") REFERENCES "Pessoa"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='EvidenciaRegistral_uniaoId_fkey') THEN
    ALTER TABLE "EvidenciaRegistral" ADD CONSTRAINT "EvidenciaRegistral_uniaoId_fkey" FOREIGN KEY ("uniaoId") REFERENCES "Uniao"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='CorrespondenciaIdentidade_ocorrenciaId_fkey') THEN
    ALTER TABLE "CorrespondenciaIdentidade" ADD CONSTRAINT "CorrespondenciaIdentidade_ocorrenciaId_fkey" FOREIGN KEY ("ocorrenciaId") REFERENCES "OcorrenciaDocumental"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='CorrespondenciaIdentidade_pessoaId_fkey') THEN
    ALTER TABLE "CorrespondenciaIdentidade" ADD CONSTRAINT "CorrespondenciaIdentidade_pessoaId_fkey" FOREIGN KEY ("pessoaId") REFERENCES "Pessoa"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='CorrespondenciaIdentidade_decididoPorId_fkey') THEN
    ALTER TABLE "CorrespondenciaIdentidade" ADD CONSTRAINT "CorrespondenciaIdentidade_decididoPorId_fkey" FOREIGN KEY ("decididoPorId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='CorrespondenciaIdentidade_decisaoDedupId_fkey') THEN
    ALTER TABLE "CorrespondenciaIdentidade" ADD CONSTRAINT "CorrespondenciaIdentidade_decisaoDedupId_fkey" FOREIGN KEY ("decisaoDedupId") REFERENCES "DecisaoDeduplicacao"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='PropostaReconciliacao_processoId_fkey') THEN
    ALTER TABLE "PropostaReconciliacao" ADD CONSTRAINT "PropostaReconciliacao_processoId_fkey" FOREIGN KEY ("processoId") REFERENCES "Processo"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='PropostaReconciliacao_arvoreId_fkey') THEN
    ALTER TABLE "PropostaReconciliacao" ADD CONSTRAINT "PropostaReconciliacao_arvoreId_fkey" FOREIGN KEY ("arvoreId") REFERENCES "Arvore"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='PropostaReconciliacao_loteId_fkey') THEN
    ALTER TABLE "PropostaReconciliacao" ADD CONSTRAINT "PropostaReconciliacao_loteId_fkey" FOREIGN KEY ("loteId") REFERENCES "LoteRegistral"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='PropostaReconciliacao_execucaoId_fkey') THEN
    ALTER TABLE "PropostaReconciliacao" ADD CONSTRAINT "PropostaReconciliacao_execucaoId_fkey" FOREIGN KEY ("execucaoId") REFERENCES "ExecucaoRegistral"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='PropostaReconciliacao_fatoId_fkey') THEN
    ALTER TABLE "PropostaReconciliacao" ADD CONSTRAINT "PropostaReconciliacao_fatoId_fkey" FOREIGN KEY ("fatoId") REFERENCES "FatoRegistral"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='PropostaReconciliacao_decididoPorId_fkey') THEN
    ALTER TABLE "PropostaReconciliacao" ADD CONSTRAINT "PropostaReconciliacao_decididoPorId_fkey" FOREIGN KEY ("decididoPorId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='PropostaReconciliacao_revertidaPorId_fkey') THEN
    ALTER TABLE "PropostaReconciliacao" ADD CONSTRAINT "PropostaReconciliacao_revertidaPorId_fkey" FOREIGN KEY ("revertidaPorId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='ConflitoRegistral_processoId_fkey') THEN
    ALTER TABLE "ConflitoRegistral" ADD CONSTRAINT "ConflitoRegistral_processoId_fkey" FOREIGN KEY ("processoId") REFERENCES "Processo"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='ConflitoRegistral_arvoreId_fkey') THEN
    ALTER TABLE "ConflitoRegistral" ADD CONSTRAINT "ConflitoRegistral_arvoreId_fkey" FOREIGN KEY ("arvoreId") REFERENCES "Arvore"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='ConflitoRegistral_loteId_fkey') THEN
    ALTER TABLE "ConflitoRegistral" ADD CONSTRAINT "ConflitoRegistral_loteId_fkey" FOREIGN KEY ("loteId") REFERENCES "LoteRegistral"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='ConflitoRegistral_execucaoId_fkey') THEN
    ALTER TABLE "ConflitoRegistral" ADD CONSTRAINT "ConflitoRegistral_execucaoId_fkey" FOREIGN KEY ("execucaoId") REFERENCES "ExecucaoRegistral"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='ConflitoRegistral_pessoaId_fkey') THEN
    ALTER TABLE "ConflitoRegistral" ADD CONSTRAINT "ConflitoRegistral_pessoaId_fkey" FOREIGN KEY ("pessoaId") REFERENCES "Pessoa"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='ConflitoRegistral_uniaoId_fkey') THEN
    ALTER TABLE "ConflitoRegistral" ADD CONSTRAINT "ConflitoRegistral_uniaoId_fkey" FOREIGN KEY ("uniaoId") REFERENCES "Uniao"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='ConflitoRegistral_propostaId_fkey') THEN
    ALTER TABLE "ConflitoRegistral" ADD CONSTRAINT "ConflitoRegistral_propostaId_fkey" FOREIGN KEY ("propostaId") REFERENCES "PropostaReconciliacao"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='ConflitoRegistral_resolvidoPorId_fkey') THEN
    ALTER TABLE "ConflitoRegistral" ADD CONSTRAINT "ConflitoRegistral_resolvidoPorId_fkey" FOREIGN KEY ("resolvidoPorId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='ImpactoAplicacaoRegistral_propostaId_fkey') THEN
    ALTER TABLE "ImpactoAplicacaoRegistral" ADD CONSTRAINT "ImpactoAplicacaoRegistral_propostaId_fkey" FOREIGN KEY ("propostaId") REFERENCES "PropostaReconciliacao"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='DecisaoRevisaoRegistral_propostaId_fkey') THEN
    ALTER TABLE "DecisaoRevisaoRegistral" ADD CONSTRAINT "DecisaoRevisaoRegistral_propostaId_fkey" FOREIGN KEY ("propostaId") REFERENCES "PropostaReconciliacao"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='DecisaoRevisaoRegistral_conflitoId_fkey') THEN
    ALTER TABLE "DecisaoRevisaoRegistral" ADD CONSTRAINT "DecisaoRevisaoRegistral_conflitoId_fkey" FOREIGN KEY ("conflitoId") REFERENCES "ConflitoRegistral"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='DecisaoRevisaoRegistral_responsavelId_fkey') THEN
    ALTER TABLE "DecisaoRevisaoRegistral" ADD CONSTRAINT "DecisaoRevisaoRegistral_responsavelId_fkey" FOREIGN KEY ("responsavelId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='VersaoGenealogica_arvoreId_fkey') THEN
    ALTER TABLE "VersaoGenealogica" ADD CONSTRAINT "VersaoGenealogica_arvoreId_fkey" FOREIGN KEY ("arvoreId") REFERENCES "Arvore"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='VersaoGenealogica_criadoPorId_fkey') THEN
    ALTER TABLE "VersaoGenealogica" ADD CONSTRAINT "VersaoGenealogica_criadoPorId_fkey" FOREIGN KEY ("criadoPorId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

