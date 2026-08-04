-- SOLICITAÇÃO DOCUMENTAL — fonte única da solicitação de certidão, dos arquivos
-- e das observações operacionais do documento.
--
-- POR QUE
-- -------
-- O que o operador preenchia em "Solicitar certidão" ficava espalhado e sem
-- registro canônico: campos soltos do Documento (protocolo, canal_solicitacao,
-- cartorio, link_acompanhamento) e `metadata.operacao` do passo. O arquivo do
-- requerimento subia para o R2 e a URL acabava em `Documento.link_acompanhamento`
-- (campo que significa outra coisa); o número do protocolo nunca virava um
-- registro `Protocolo`; e a aba Protocolo do documento não tinha o que ler.
--
-- O QUE ESTA MIGRATION FAZ
-- ------------------------
--   • SolicitacaoDocumento  — o ATO de solicitar (canal, destinatário, envio,
--                             prazo, observação, autoria, vínculos de execução).
--   • DocumentoArquivo      — registro ÚNICO por arquivo do documento. O binário
--                             continua um só no R2; aqui mora a referência, com
--                             origem (solicitação/etapa), tipo, autor e data.
--   • DocumentoObservacao   — observação append-only, com autor e carimbo.
--   • Protocolo.solicitacaoId + Protocolo.origem — o protocolo continua sendo o
--                             MESMO cadastro que já existe. Não nasce um segundo:
--                             ele só passa a poder apontar para a solicitação que
--                             o originou, e a declarar de onde veio.
--
-- ADITIVA e IDEMPOTENTE: só cria tipos, tabelas, colunas, índices e chaves
-- estrangeiras novas. Nenhuma linha existente é lida, alterada ou removida;
-- nenhuma coluna é dropada; nenhum comportamento atual muda. Reexecutar é seguro.
--
-- ROLLBACK: `DROP TABLE "DocumentoObservacao", "DocumentoArquivo";`
--           `ALTER TABLE "Protocolo" DROP CONSTRAINT "Protocolo_solicitacaoId_fkey";`
--           `DROP TABLE "SolicitacaoDocumento";`
--           `ALTER TABLE "Protocolo" DROP COLUMN "solicitacaoId", DROP COLUMN "origem";`
--           `DROP TYPE "TipoArquivoDocumento", "StatusSolicitacaoDocumento", "CanalSolicitacaoDocumento";`
--           Sem perda de dado pré-existente: tudo aqui é novo.

-- ── Tipos de domínio (dimensões FECHADAS, não cadastro mestre) ───────────────
DO $$ BEGIN
  CREATE TYPE "CanalSolicitacaoDocumento" AS ENUM ('CRC', 'ECARTORIO', 'EMAIL', 'WHATSAPP', 'BALCAO', 'COMUNE', 'CORREIOS', 'CONSULADO');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "StatusSolicitacaoDocumento" AS ENUM ('AGUARDANDO_PROTOCOLO', 'PROTOCOLADA', 'RESPONDIDA', 'CANCELADA');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "TipoArquivoDocumento" AS ENUM ('REQUERIMENTO_ENVIADO', 'COMPROVANTE_PROTOCOLO', 'COMPROVANTE_CONTATO', 'DOCUMENTO_RECEBIDO', 'OUTRO');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── SolicitacaoDocumento ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "SolicitacaoDocumento" (
    "id" SERIAL NOT NULL,
    "documentoId" INTEGER NOT NULL,
    "processoId" INTEGER NOT NULL,
    "pessoaId" INTEGER NOT NULL,
    "faseMacroKey" VARCHAR(60) NOT NULL,
    "workflowInstanceId" INTEGER,
    "stepInstanceId" INTEGER,
    "tarefaId" INTEGER,
    "canal" "CanalSolicitacaoDocumento" NOT NULL,
    "orgaoId" INTEGER,
    "destinatarioNome" VARCHAR(200),
    "atendente" VARCHAR(200),
    "dataEnvio" TIMESTAMP(3) NOT NULL,
    "prazoEsperadoDias" INTEGER,
    "previsaoRetorno" TIMESTAMP(3),
    "observacao" TEXT,
    "custoPago" DECIMAL(12,2),
    "formaPagamento" VARCHAR(40),
    "linkAcompanhamento" VARCHAR(500),
    "codigoRastreio" VARCHAR(100),
    "status" "StatusSolicitacaoDocumento" NOT NULL DEFAULT 'AGUARDANDO_PROTOCOLO',
    "criadoPorId" INTEGER,
    "chaveIdempotencia" VARCHAR(200) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SolicitacaoDocumento_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "SolicitacaoDocumento_chaveIdempotencia_key" ON "SolicitacaoDocumento"("chaveIdempotencia");
CREATE INDEX IF NOT EXISTS "SolicitacaoDocumento_documentoId_createdAt_idx" ON "SolicitacaoDocumento"("documentoId", "createdAt");
CREATE INDEX IF NOT EXISTS "SolicitacaoDocumento_processoId_idx" ON "SolicitacaoDocumento"("processoId");
CREATE INDEX IF NOT EXISTS "SolicitacaoDocumento_stepInstanceId_idx" ON "SolicitacaoDocumento"("stepInstanceId");
CREATE INDEX IF NOT EXISTS "SolicitacaoDocumento_tarefaId_idx" ON "SolicitacaoDocumento"("tarefaId");
CREATE INDEX IF NOT EXISTS "SolicitacaoDocumento_status_idx" ON "SolicitacaoDocumento"("status");

-- ── DocumentoArquivo ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "DocumentoArquivo" (
    "id" SERIAL NOT NULL,
    "documentoId" INTEGER NOT NULL,
    "solicitacaoId" INTEGER,
    "stepInstanceId" INTEGER,
    "tipo" "TipoArquivoDocumento" NOT NULL DEFAULT 'OUTRO',
    "url" TEXT NOT NULL,
    "nome" VARCHAR(300) NOT NULL,
    "mimeType" VARCHAR(120),
    "tamanho" INTEGER,
    "criadoPorId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DocumentoArquivo_pkey" PRIMARY KEY ("id")
);

-- DEDUP estrutural: o mesmo arquivo não entra duas vezes no mesmo documento.
-- É esta constraint que faz o retry de upload não duplicar linha.
CREATE UNIQUE INDEX IF NOT EXISTS "DocumentoArquivo_documentoId_url_key" ON "DocumentoArquivo"("documentoId", "url");
CREATE INDEX IF NOT EXISTS "DocumentoArquivo_documentoId_createdAt_idx" ON "DocumentoArquivo"("documentoId", "createdAt");
CREATE INDEX IF NOT EXISTS "DocumentoArquivo_stepInstanceId_idx" ON "DocumentoArquivo"("stepInstanceId");
CREATE INDEX IF NOT EXISTS "DocumentoArquivo_solicitacaoId_idx" ON "DocumentoArquivo"("solicitacaoId");
CREATE INDEX IF NOT EXISTS "DocumentoArquivo_tipo_idx" ON "DocumentoArquivo"("tipo");

-- ── DocumentoObservacao ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "DocumentoObservacao" (
    "id" SERIAL NOT NULL,
    "documentoId" INTEGER NOT NULL,
    "solicitacaoId" INTEGER,
    "stepInstanceId" INTEGER,
    "texto" TEXT NOT NULL,
    "criadoPorId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "chaveIdempotencia" VARCHAR(200) NOT NULL,
    CONSTRAINT "DocumentoObservacao_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "DocumentoObservacao_chaveIdempotencia_key" ON "DocumentoObservacao"("chaveIdempotencia");
CREATE INDEX IF NOT EXISTS "DocumentoObservacao_documentoId_createdAt_idx" ON "DocumentoObservacao"("documentoId", "createdAt");
CREATE INDEX IF NOT EXISTS "DocumentoObservacao_stepInstanceId_idx" ON "DocumentoObservacao"("stepInstanceId");

-- ── Protocolo: vínculo com a solicitação (MESMO cadastro, sem segundo) ──────
ALTER TABLE "Protocolo" ADD COLUMN IF NOT EXISTS "origem" VARCHAR(30) NOT NULL DEFAULT 'PROCESSO';
ALTER TABLE "Protocolo" ADD COLUMN IF NOT EXISTS "solicitacaoId" INTEGER;
CREATE INDEX IF NOT EXISTS "Protocolo_solicitacaoId_idx" ON "Protocolo"("solicitacaoId");

-- ── Chaves estrangeiras (integridade referencial explícita) ─────────────────
DO $$ BEGIN
  ALTER TABLE "SolicitacaoDocumento" ADD CONSTRAINT "SolicitacaoDocumento_documentoId_fkey"
    FOREIGN KEY ("documentoId") REFERENCES "Documento"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "SolicitacaoDocumento" ADD CONSTRAINT "SolicitacaoDocumento_orgaoId_fkey"
    FOREIGN KEY ("orgaoId") REFERENCES "OrgaoProtocolo"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "SolicitacaoDocumento" ADD CONSTRAINT "SolicitacaoDocumento_criadoPorId_fkey"
    FOREIGN KEY ("criadoPorId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "DocumentoArquivo" ADD CONSTRAINT "DocumentoArquivo_documentoId_fkey"
    FOREIGN KEY ("documentoId") REFERENCES "Documento"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "DocumentoArquivo" ADD CONSTRAINT "DocumentoArquivo_solicitacaoId_fkey"
    FOREIGN KEY ("solicitacaoId") REFERENCES "SolicitacaoDocumento"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "DocumentoArquivo" ADD CONSTRAINT "DocumentoArquivo_criadoPorId_fkey"
    FOREIGN KEY ("criadoPorId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "DocumentoObservacao" ADD CONSTRAINT "DocumentoObservacao_documentoId_fkey"
    FOREIGN KEY ("documentoId") REFERENCES "Documento"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "DocumentoObservacao" ADD CONSTRAINT "DocumentoObservacao_criadoPorId_fkey"
    FOREIGN KEY ("criadoPorId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- O protocolo pertence a uma solicitação VÁLIDA quando aponta para uma: FK real,
-- com CASCADE — apagar a solicitação não deixa protocolo órfão apontando para o nada.
DO $$ BEGIN
  ALTER TABLE "Protocolo" ADD CONSTRAINT "Protocolo_solicitacaoId_fkey"
    FOREIGN KEY ("solicitacaoId") REFERENCES "SolicitacaoDocumento"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
