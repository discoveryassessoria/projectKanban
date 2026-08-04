-- CONTRATO DOCUMENTAL — o cadastro passa a declarar o que o código sabia sozinho.
--
-- POR QUE
-- -------
-- O Workflow Interno só declarava a que FASE pertencia. Que "Emissão Documental"
-- executa uma vez por DOCUMENTO era conhecimento do motor (escopo canônico da
-- fase, em fases-catalog), não do cadastro. Sem contrato declarado, os estados
-- inválidos eram possíveis porque não havia o que violar: passo documental sem
-- documento, tarefa documental sem documento, workflow aplicado a tipo
-- documental incompatível.
--
-- O QUE ESTA MIGRATION CRIA
-- -------------------------
--   • FamiliaDocumental            — o que o documento É, em grupo operacional.
--   • NaturezaOperacionalDocumento — COMO ele entra na operação; `exigeWorkflow`
--                                    separa o que se processa do que só se anexa.
--   • PerfilOperacionalDocumento   — a ponte cadastro ↔ workflow publicado.
--   • TipoDocumentoCadastro        — +familia, +natureza, +perfil.
--   • PhaseInternalWorkflow        — +escopoExecucao, +familia, +exigeDocumento,
--                                    +exigePessoa.
--
-- O QUE ELA NÃO FAZ
-- -----------------
-- Não cria cadastro para a dimensão de escopo (PROCESSO/PESSOA/NECESSIDADE/
-- DOCUMENTO): é dimensão FECHADA, sem atributo administrável, e já existe como
-- tipo canônico único no motor. Cadastro seria segunda fonte para o mesmo fato.
--
-- Não toca em `PhaseInternalWorkflowStep.cardinalidade`: a coluna já existe e o
-- motor já a lê. Declarar a cardinalidade dos cinco passos é BACKFILL de
-- configuração, não schema.
--
-- ADITIVA e IDEMPOTENTE: só cria tipo, tabela, coluna, índice e FK novos. Nenhuma
-- linha existente é lida, alterada ou removida; nenhuma coluna é dropada; nenhum
-- comportamento atual muda. Todas as colunas novas nascem NULL ou com default
-- que preserva o comportamento de hoje (`exigeDocumento`/`exigePessoa` = false).
--
-- ROLLBACK (sem perda de dado pré-existente — tudo aqui é novo):
--   ALTER TABLE "PhaseInternalWorkflow" DROP COLUMN "escopoExecucao",
--     DROP COLUMN "familiaDocumentalId", DROP COLUMN "exigeDocumento",
--     DROP COLUMN "exigePessoa";
--   ALTER TABLE "TipoDocumentoCadastro" DROP COLUMN "familiaDocumentalId",
--     DROP COLUMN "naturezaOperacionalId", DROP COLUMN "perfilOperacionalId";
--   DROP TABLE "PerfilOperacionalDocumento", "NaturezaOperacionalDocumento",
--     "FamiliaDocumental";
--   DROP TYPE "EscopoExecucao";

-- ── Dimensão fechada de escopo ──────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE "EscopoExecucao" AS ENUM ('PROCESSO', 'PESSOA', 'NECESSIDADE', 'DOCUMENTO');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── FamiliaDocumental ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "FamiliaDocumental" (
    "id" SERIAL NOT NULL,
    "code" VARCHAR(40) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "descricao" TEXT,
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "sistema" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "FamiliaDocumental_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "FamiliaDocumental_code_key" ON "FamiliaDocumental"("code");

-- ── NaturezaOperacionalDocumento ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "NaturezaOperacionalDocumento" (
    "id" SERIAL NOT NULL,
    "code" VARCHAR(40) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "descricao" TEXT,
    "exigeWorkflow" BOOLEAN NOT NULL DEFAULT false,
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "sistema" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "NaturezaOperacionalDocumento_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "NaturezaOperacionalDocumento_code_key" ON "NaturezaOperacionalDocumento"("code");

-- ── PerfilOperacionalDocumento ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "PerfilOperacionalDocumento" (
    "id" SERIAL NOT NULL,
    "code" VARCHAR(40) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "descricao" TEXT,
    "workflowId" INTEGER,
    "familiaDocumentalId" INTEGER,
    "escopoInstanciacao" "EscopoExecucao" NOT NULL DEFAULT 'DOCUMENTO',
    "exigeProcesso" BOOLEAN NOT NULL DEFAULT true,
    "exigePessoa" BOOLEAN NOT NULL DEFAULT true,
    "exigeDocumento" BOOLEAN NOT NULL DEFAULT true,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "sistema" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PerfilOperacionalDocumento_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "PerfilOperacionalDocumento_code_key" ON "PerfilOperacionalDocumento"("code");
CREATE INDEX IF NOT EXISTS "PerfilOperacionalDocumento_workflowId_idx" ON "PerfilOperacionalDocumento"("workflowId");
CREATE INDEX IF NOT EXISTS "PerfilOperacionalDocumento_familiaDocumentalId_idx" ON "PerfilOperacionalDocumento"("familiaDocumentalId");

-- ── TipoDocumentoCadastro: o contrato do documento ──────────────────────────
ALTER TABLE "TipoDocumentoCadastro" ADD COLUMN IF NOT EXISTS "familiaDocumentalId" INTEGER;
ALTER TABLE "TipoDocumentoCadastro" ADD COLUMN IF NOT EXISTS "naturezaOperacionalId" INTEGER;
ALTER TABLE "TipoDocumentoCadastro" ADD COLUMN IF NOT EXISTS "perfilOperacionalId" INTEGER;
CREATE INDEX IF NOT EXISTS "TipoDocumentoCadastro_familiaDocumentalId_idx" ON "TipoDocumentoCadastro"("familiaDocumentalId");
CREATE INDEX IF NOT EXISTS "TipoDocumentoCadastro_naturezaOperacionalId_idx" ON "TipoDocumentoCadastro"("naturezaOperacionalId");
CREATE INDEX IF NOT EXISTS "TipoDocumentoCadastro_perfilOperacionalId_idx" ON "TipoDocumentoCadastro"("perfilOperacionalId");

-- ── PhaseInternalWorkflow: o contrato da execução ───────────────────────────
-- Defaults FALSE de propósito: nenhum workflow existente passa a exigir nada por
-- efeito desta migration. Quem exige documento é declarado no backfill, um a um.
ALTER TABLE "PhaseInternalWorkflow" ADD COLUMN IF NOT EXISTS "escopoExecucao" "EscopoExecucao";
ALTER TABLE "PhaseInternalWorkflow" ADD COLUMN IF NOT EXISTS "familiaDocumentalId" INTEGER;
ALTER TABLE "PhaseInternalWorkflow" ADD COLUMN IF NOT EXISTS "exigeDocumento" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "PhaseInternalWorkflow" ADD COLUMN IF NOT EXISTS "exigePessoa" BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS "PhaseInternalWorkflow_familiaDocumentalId_idx" ON "PhaseInternalWorkflow"("familiaDocumentalId");

-- ── Chaves estrangeiras ─────────────────────────────────────────────────────
-- RESTRICT no workflow do perfil: workflow que processa documento não some do
-- cadastro por baixo do perfil que o referencia.
DO $$ BEGIN
  ALTER TABLE "PerfilOperacionalDocumento" ADD CONSTRAINT "PerfilOperacionalDocumento_workflowId_fkey"
    FOREIGN KEY ("workflowId") REFERENCES "PhaseInternalWorkflow"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "PerfilOperacionalDocumento" ADD CONSTRAINT "PerfilOperacionalDocumento_familiaDocumentalId_fkey"
    FOREIGN KEY ("familiaDocumentalId") REFERENCES "FamiliaDocumental"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "TipoDocumentoCadastro" ADD CONSTRAINT "TipoDocumentoCadastro_familiaDocumentalId_fkey"
    FOREIGN KEY ("familiaDocumentalId") REFERENCES "FamiliaDocumental"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "TipoDocumentoCadastro" ADD CONSTRAINT "TipoDocumentoCadastro_naturezaOperacionalId_fkey"
    FOREIGN KEY ("naturezaOperacionalId") REFERENCES "NaturezaOperacionalDocumento"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "TipoDocumentoCadastro" ADD CONSTRAINT "TipoDocumentoCadastro_perfilOperacionalId_fkey"
    FOREIGN KEY ("perfilOperacionalId") REFERENCES "PerfilOperacionalDocumento"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "PhaseInternalWorkflow" ADD CONSTRAINT "PhaseInternalWorkflow_familiaDocumentalId_fkey"
    FOREIGN KEY ("familiaDocumentalId") REFERENCES "FamiliaDocumental"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
