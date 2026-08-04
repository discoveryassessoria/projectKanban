-- REQUERIMENTO (DOC21) — o vínculo completo do arquivo com o cadastro mestre, o
-- protocolo e o histórico de versões.
--
-- POR QUE
-- -------
-- `DocumentoArquivo` já existia (migration 20260804_solicitacao_documental) e já
-- ligava o arquivo ao DOCUMENTO, à SOLICITAÇÃO e à ETAPA. Faltavam três coisas
-- para o requerimento enviado ao cartório ser realmente rastreável:
--
--   1. CLASSIFICAÇÃO MESTRE — o arquivo não dizia O QUE ele é. "Requerimento
--      inteiro teor" (DOC21) existe no Cadastro Mestre de Documentos, mas nada
--      apontava para ele: a única pista era o rótulo do campo na tela, isto é,
--      texto. Agora o arquivo carrega `documentTypeId`, o ID oficial.
--   2. PROTOCOLO — o arquivo chegava ao protocolo por caminho indireto (arquivo →
--      solicitação → protocolo). O vínculo direto torna a aba Protocolo uma
--      consulta, não uma reconstrução.
--   3. VERSÃO — "Trocar" o requerimento numa etapa reaberta não tinha como
--      preservar a versão anterior sem sobrescrever a linha (e o storageKey).
--
-- E cria a configuração que declara a exigência POR ID, não por texto:
--   • ExigenciaEvidenciaEtapa — "o passo X, para documento operacional do tipo T
--     no canal C, exige evidência do tipo mestre D com a finalidade F".
--
-- ADITIVA e IDEMPOTENTE: só cria tabela, colunas, índices e chaves estrangeiras
-- novas. Nenhuma linha existente é alterada ou removida, nenhuma coluna é dropada,
-- nenhum comportamento atual muda. Reexecutar é seguro.
--
-- ROLLBACK (sem perda de dado pré-existente — tudo aqui é novo):
--   DROP TABLE "ExigenciaEvidenciaEtapa";
--   DROP INDEX "DocumentoArquivo_solicitacao_evidencia_vigente_key";
--   ALTER TABLE "DocumentoArquivo"
--     DROP COLUMN "protocoloId", DROP COLUMN "documentTypeId",
--     DROP COLUMN "hashConteudo", DROP COLUMN "vigente",
--     DROP COLUMN "substituiId", DROP COLUMN "substituidoEm",
--     DROP COLUMN "motivoSubstituicao";

-- ── DocumentoArquivo: vínculos que faltavam ─────────────────────────────────
ALTER TABLE "DocumentoArquivo" ADD COLUMN IF NOT EXISTS "protocoloId" INTEGER;
ALTER TABLE "DocumentoArquivo" ADD COLUMN IF NOT EXISTS "documentTypeId" INTEGER;
ALTER TABLE "DocumentoArquivo" ADD COLUMN IF NOT EXISTS "hashConteudo" VARCHAR(80);

-- Versionamento. `vigente` nasce TRUE para todo mundo: o que existe hoje é, por
-- definição, a versão vigente — nenhuma substituição aconteceu ainda.
ALTER TABLE "DocumentoArquivo" ADD COLUMN IF NOT EXISTS "vigente" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "DocumentoArquivo" ADD COLUMN IF NOT EXISTS "substituiId" INTEGER;
ALTER TABLE "DocumentoArquivo" ADD COLUMN IF NOT EXISTS "substituidoEm" TIMESTAMP(3);
ALTER TABLE "DocumentoArquivo" ADD COLUMN IF NOT EXISTS "motivoSubstituicao" VARCHAR(300);

CREATE UNIQUE INDEX IF NOT EXISTS "DocumentoArquivo_substituiId_key" ON "DocumentoArquivo"("substituiId");
CREATE INDEX IF NOT EXISTS "DocumentoArquivo_protocoloId_idx" ON "DocumentoArquivo"("protocoloId");
CREATE INDEX IF NOT EXISTS "DocumentoArquivo_documentTypeId_idx" ON "DocumentoArquivo"("documentTypeId");
CREATE INDEX IF NOT EXISTS "DocumentoArquivo_vigente_idx" ON "DocumentoArquivo"("vigente");

-- TRAVA DE DOMÍNIO: uma solicitação tem NO MÁXIMO UMA versão vigente de cada
-- documento mestre. É o que impede "duas versões vigentes do DOC21" mesmo que a
-- aplicação falhe no meio da substituição — a garantia é do banco, não da tela.
-- Índice PARCIAL de propósito: o histórico (vigente=false) pode ter quantas
-- versões forem necessárias, e arquivo sem solicitação/sem classificação não entra
-- na regra.
CREATE UNIQUE INDEX IF NOT EXISTS "DocumentoArquivo_solicitacao_evidencia_vigente_key"
  ON "DocumentoArquivo"("solicitacaoId", "documentTypeId")
  WHERE "vigente" AND "solicitacaoId" IS NOT NULL AND "documentTypeId" IS NOT NULL;

DO $$ BEGIN
  ALTER TABLE "DocumentoArquivo" ADD CONSTRAINT "DocumentoArquivo_protocoloId_fkey"
    FOREIGN KEY ("protocoloId") REFERENCES "Protocolo"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- RESTRICT: um tipo do Cadastro Mestre que classifica arquivo não some do cadastro
-- por baixo do arquivo. Desclassificar evidência já usada é decisão administrativa.
DO $$ BEGIN
  ALTER TABLE "DocumentoArquivo" ADD CONSTRAINT "DocumentoArquivo_documentTypeId_fkey"
    FOREIGN KEY ("documentTypeId") REFERENCES "TipoDocumentoCadastro"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "DocumentoArquivo" ADD CONSTRAINT "DocumentoArquivo_substituiId_fkey"
    FOREIGN KEY ("substituiId") REFERENCES "DocumentoArquivo"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── ExigenciaEvidenciaEtapa ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "ExigenciaEvidenciaEtapa" (
    "id" SERIAL NOT NULL,
    "stepKey" VARCHAR(80) NOT NULL,
    "documentoTipoId" INTEGER,
    "canal" "CanalSolicitacaoDocumento",
    "evidenciaTipoId" INTEGER NOT NULL,
    "finalidade" "TipoArquivoDocumento" NOT NULL DEFAULT 'REQUERIMENTO_ENVIADO',
    "obrigatoria" BOOLEAN NOT NULL DEFAULT true,
    "cardinalidadeMax" INTEGER NOT NULL DEFAULT 1,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "chaveExigencia" VARCHAR(140) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ExigenciaEvidenciaEtapa_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ExigenciaEvidenciaEtapa_chaveExigencia_key" ON "ExigenciaEvidenciaEtapa"("chaveExigencia");
CREATE INDEX IF NOT EXISTS "ExigenciaEvidenciaEtapa_stepKey_idx" ON "ExigenciaEvidenciaEtapa"("stepKey");
CREATE INDEX IF NOT EXISTS "ExigenciaEvidenciaEtapa_evidenciaTipoId_idx" ON "ExigenciaEvidenciaEtapa"("evidenciaTipoId");
CREATE INDEX IF NOT EXISTS "ExigenciaEvidenciaEtapa_documentoTipoId_idx" ON "ExigenciaEvidenciaEtapa"("documentoTipoId");

DO $$ BEGIN
  ALTER TABLE "ExigenciaEvidenciaEtapa" ADD CONSTRAINT "ExigenciaEvidenciaEtapa_documentoTipoId_fkey"
    FOREIGN KEY ("documentoTipoId") REFERENCES "TipoDocumentoCadastro"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "ExigenciaEvidenciaEtapa" ADD CONSTRAINT "ExigenciaEvidenciaEtapa_evidenciaTipoId_fkey"
    FOREIGN KEY ("evidenciaTipoId") REFERENCES "TipoDocumentoCadastro"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
