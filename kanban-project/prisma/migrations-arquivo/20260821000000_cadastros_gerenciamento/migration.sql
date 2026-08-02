-- Cadastros do Gerenciamento (reestruturação 26/07/2026)
-- 100% ADITIVO E IDEMPOTENTE: só CREATE TABLE/INDEX IF NOT EXISTS.
-- Nenhum DROP, nenhum ALTER de coluna existente, nenhum dado tocado.

CREATE TABLE IF NOT EXISTS "MarcoProcesso" (
  "id" SERIAL PRIMARY KEY,
  "code" VARCHAR(60) NOT NULL,
  "nome" VARCHAR(200) NOT NULL,
  "descricao" TEXT,
  "tipoProcessoId" INTEGER,
  "phaseKey" VARCHAR(60),
  "ordem" INTEGER NOT NULL DEFAULT 0,
  "ativo" BOOLEAN NOT NULL DEFAULT true,
  "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "atualizadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "MarcoProcesso_code_key" ON "MarcoProcesso"("code");
CREATE INDEX IF NOT EXISTS "MarcoProcesso_tipoProcessoId_idx" ON "MarcoProcesso"("tipoProcessoId");
CREATE INDEX IF NOT EXISTS "MarcoProcesso_phaseKey_idx" ON "MarcoProcesso"("phaseKey");

CREATE TABLE IF NOT EXISTS "CategoriaServico" (
  "id" SERIAL PRIMARY KEY,
  "code" VARCHAR(60) NOT NULL,
  "nome" VARCHAR(200) NOT NULL,
  "descricao" TEXT,
  "ordem" INTEGER NOT NULL DEFAULT 0,
  "ativo" BOOLEAN NOT NULL DEFAULT true,
  "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "atualizadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "CategoriaServico_code_key" ON "CategoriaServico"("code");

CREATE TABLE IF NOT EXISTS "CategoriaOrganizacao" (
  "id" SERIAL PRIMARY KEY,
  "code" VARCHAR(60) NOT NULL,
  "nome" VARCHAR(200) NOT NULL,
  "descricao" TEXT,
  "ordem" INTEGER NOT NULL DEFAULT 0,
  "ativo" BOOLEAN NOT NULL DEFAULT true,
  "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "atualizadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "CategoriaOrganizacao_code_key" ON "CategoriaOrganizacao"("code");

CREATE TABLE IF NOT EXISTS "OrganizacaoCategoria" (
  "id" SERIAL PRIMARY KEY,
  "orgaoId" INTEGER NOT NULL,
  "categoriaId" INTEGER NOT NULL,
  "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "OrganizacaoCategoria_orgaoId_categoriaId_key" ON "OrganizacaoCategoria"("orgaoId", "categoriaId");
CREATE INDEX IF NOT EXISTS "OrganizacaoCategoria_categoriaId_idx" ON "OrganizacaoCategoria"("categoriaId");

CREATE TABLE IF NOT EXISTS "GrupoUsuario" (
  "id" SERIAL PRIMARY KEY,
  "code" VARCHAR(40),
  "nome" VARCHAR(200) NOT NULL,
  "descricao" TEXT,
  "ativo" BOOLEAN NOT NULL DEFAULT true,
  "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "atualizadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "GrupoUsuarioMembro" (
  "id" SERIAL PRIMARY KEY,
  "grupoId" INTEGER NOT NULL,
  "usuarioId" INTEGER NOT NULL,
  "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "GrupoUsuarioMembro_grupoId_usuarioId_key" ON "GrupoUsuarioMembro"("grupoId", "usuarioId");
CREATE INDEX IF NOT EXISTS "GrupoUsuarioMembro_usuarioId_idx" ON "GrupoUsuarioMembro"("usuarioId");

CREATE TABLE IF NOT EXISTS "CargoCadastro" (
  "id" SERIAL PRIMARY KEY,
  "code" VARCHAR(60) NOT NULL,
  "nome" VARCHAR(200) NOT NULL,
  "area" VARCHAR(80),
  "descricao" TEXT,
  "ativo" BOOLEAN NOT NULL DEFAULT true,
  "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "atualizadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "CargoCadastro_code_key" ON "CargoCadastro"("code");

CREATE TABLE IF NOT EXISTS "TipoProtocoloCadastro" (
  "id" SERIAL PRIMARY KEY,
  "code" VARCHAR(60) NOT NULL,
  "nome" VARCHAR(200) NOT NULL,
  "escopo" VARCHAR(40),
  "nacionalidade" VARCHAR(60),
  "observacoes" TEXT,
  "ordem" INTEGER NOT NULL DEFAULT 0,
  "ativo" BOOLEAN NOT NULL DEFAULT true,
  "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "atualizadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "TipoProtocoloCadastro_code_key" ON "TipoProtocoloCadastro"("code");

CREATE TABLE IF NOT EXISTS "ConfiguracaoSistema" (
  "chave" VARCHAR(80) PRIMARY KEY,
  "valor" TEXT,
  "grupo" VARCHAR(40) NOT NULL DEFAULT 'geral',
  "atualizadoPor" INTEGER,
  "atualizadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "ConfiguracaoSistema_grupo_idx" ON "ConfiguracaoSistema"("grupo");

CREATE TABLE IF NOT EXISTS "ModeloDocumento" (
  "id" SERIAL PRIMARY KEY,
  "code" VARCHAR(60) NOT NULL,
  "nome" VARCHAR(200) NOT NULL,
  "tipo" VARCHAR(40),
  "categoria" VARCHAR(80),
  "conteudo" TEXT,
  "variaveis" TEXT,
  "ativo" BOOLEAN NOT NULL DEFAULT true,
  "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "atualizadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "ModeloDocumento_code_key" ON "ModeloDocumento"("code");

CREATE TABLE IF NOT EXISTS "RegraNotificacao" (
  "id" SERIAL PRIMARY KEY,
  "code" VARCHAR(60) NOT NULL,
  "nome" VARCHAR(200) NOT NULL,
  "gatilho" VARCHAR(80) NOT NULL,
  "entidade" VARCHAR(60),
  "canais" VARCHAR(120),
  "destinatarios" VARCHAR(200),
  "modeloCode" VARCHAR(60),
  "ativo" BOOLEAN NOT NULL DEFAULT true,
  "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "atualizadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "RegraNotificacao_code_key" ON "RegraNotificacao"("code");

-- Chaves estrangeiras — idempotentes por DROP IF EXISTS + ADD.
-- (sem bloco DO $$: o aplicador de produção divide o arquivo por ";")
ALTER TABLE "OrganizacaoCategoria" DROP CONSTRAINT IF EXISTS "OrganizacaoCategoria_orgaoId_fkey";
ALTER TABLE "OrganizacaoCategoria" ADD CONSTRAINT "OrganizacaoCategoria_orgaoId_fkey" FOREIGN KEY ("orgaoId") REFERENCES "OrgaoProtocolo"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OrganizacaoCategoria" DROP CONSTRAINT IF EXISTS "OrganizacaoCategoria_categoriaId_fkey";
ALTER TABLE "OrganizacaoCategoria" ADD CONSTRAINT "OrganizacaoCategoria_categoriaId_fkey" FOREIGN KEY ("categoriaId") REFERENCES "CategoriaOrganizacao"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GrupoUsuarioMembro" DROP CONSTRAINT IF EXISTS "GrupoUsuarioMembro_grupoId_fkey";
ALTER TABLE "GrupoUsuarioMembro" ADD CONSTRAINT "GrupoUsuarioMembro_grupoId_fkey" FOREIGN KEY ("grupoId") REFERENCES "GrupoUsuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GrupoUsuarioMembro" DROP CONSTRAINT IF EXISTS "GrupoUsuarioMembro_usuarioId_fkey";
ALTER TABLE "GrupoUsuarioMembro" ADD CONSTRAINT "GrupoUsuarioMembro_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;
