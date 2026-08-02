-- SAÚDE DO SISTEMA — persistência de execuções e achados.
--
-- 100% ADITIVO: duas tabelas novas, nenhuma tabela existente é tocada. O motor
-- antigo (6 verificações do /api/gerenciamento/diagnostico) continua no ar sem
-- alteração — a migração para o motor novo é gradual, como pedido.
--
-- O histórico de saúde NUNCA é apagado: é ele que distingue problema novo de
-- recorrente e mede tempo de resolução.

CREATE TABLE IF NOT EXISTS "SaudeExecucao" (
  "id"                   SERIAL PRIMARY KEY,
  "modo"                 VARCHAR(20)  NOT NULL,
  "estado"               VARCHAR(30)  NOT NULL,
  "motivoEstado"         TEXT         NOT NULL,
  "versaoCatalogo"       VARCHAR(20)  NOT NULL,
  "iniciadoEm"           TIMESTAMP(3) NOT NULL,
  "concluidoEm"          TIMESTAMP(3) NOT NULL,
  "duracaoMs"            INTEGER      NOT NULL,
  "totalCatalogo"        INTEGER      NOT NULL,
  "totalElegiveis"       INTEGER      NOT NULL,
  "executadas"           INTEGER      NOT NULL,
  "aprovadas"            INTEGER      NOT NULL,
  "comAchados"           INTEGER      NOT NULL,
  "falhasTecnicas"       INTEGER      NOT NULL,
  "naoExecutadas"        INTEGER      NOT NULL,
  "coberturaPercentual"  INTEGER      NOT NULL,
  "criticos"             INTEGER      NOT NULL,
  "erros"                INTEGER      NOT NULL,
  "alertas"              INTEGER      NOT NULL,
  "informativos"         INTEGER      NOT NULL,
  "execucoes"            JSONB        NOT NULL,
  "dominiosSemCobertura" TEXT[]       NOT NULL DEFAULT '{}',
  "disparadoPorId"       INTEGER,
  "criadoEm"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "SaudeExecucao_criadoEm_idx" ON "SaudeExecucao"("criadoEm");
CREATE INDEX IF NOT EXISTS "SaudeExecucao_estado_idx"   ON "SaudeExecucao"("estado");
CREATE INDEX IF NOT EXISTS "SaudeExecucao_modo_idx"     ON "SaudeExecucao"("modo");

CREATE TABLE IF NOT EXISTS "SaudeAchado" (
  "id"                 SERIAL PRIMARY KEY,
  "chave"              VARCHAR(300) NOT NULL,
  "codigo"             VARCHAR(60)  NOT NULL,
  "dominio"            VARCHAR(40)  NOT NULL,
  "modulo"             VARCHAR(60)  NOT NULL,
  "severidade"         VARCHAR(20)  NOT NULL,
  "titulo"             VARCHAR(300) NOT NULL,
  "descricao"          TEXT         NOT NULL,
  "explicacao"         TEXT,
  "impacto"            TEXT,
  "entidade"           VARCHAR(80),
  "registroId"         VARCHAR(60),
  "registroNome"       VARCHAR(300),
  "quantidade"         INTEGER      NOT NULL DEFAULT 1,
  "link"               VARCHAR(300),
  "recomendacao"       TEXT,
  "correcaoAutomatica" VARCHAR(60),
  "evidencia"          JSONB,
  "status"             VARCHAR(20)  NOT NULL DEFAULT 'ABERTO',
  "primeiraDeteccao"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "ultimaDeteccao"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolvidoEm"        TIMESTAMP(3),
  "recorrencias"       INTEGER      NOT NULL DEFAULT 1,
  "responsavelId"      INTEGER,
  "justificativa"      TEXT,
  "ignoradoPorId"      INTEGER,
  "ignoradoAte"        TIMESTAMP(3),
  "versaoCatalogo"     VARCHAR(20)  NOT NULL,
  "execucaoId"         INTEGER,
  "atualizadoEm"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "SaudeAchado_chave_key"        ON "SaudeAchado"("chave");
CREATE INDEX IF NOT EXISTS "SaudeAchado_status_idx"              ON "SaudeAchado"("status");
CREATE INDEX IF NOT EXISTS "SaudeAchado_severidade_idx"          ON "SaudeAchado"("severidade");
CREATE INDEX IF NOT EXISTS "SaudeAchado_dominio_idx"             ON "SaudeAchado"("dominio");
CREATE INDEX IF NOT EXISTS "SaudeAchado_codigo_idx"              ON "SaudeAchado"("codigo");
CREATE INDEX IF NOT EXISTS "SaudeAchado_ultimaDeteccao_idx"      ON "SaudeAchado"("ultimaDeteccao");

ALTER TABLE "SaudeAchado" DROP CONSTRAINT IF EXISTS "SaudeAchado_execucaoId_fkey";
ALTER TABLE "SaudeAchado" ADD CONSTRAINT "SaudeAchado_execucaoId_fkey"
  FOREIGN KEY ("execucaoId") REFERENCES "SaudeExecucao"("id") ON DELETE SET NULL ON UPDATE CASCADE;
