-- O PROFISSIONAL VIRA CADASTRO, E O PEDIDO DE RETIFICAÇÃO PASSA A APONTAR PARA ELE.
--
-- ─── POR QUE UMA ENTIDADE NOVA ──────────────────────────────────────────────
-- Procurei onde o advogado caberia sem distorção e não achei:
--
--   `Pessoa`         é o indivíduo da árvore genealógica — tem data de óbito, local
--                    de batismo, país de nascimento. Um advogado não é ancestral.
--   `Usuario`        tem e-mail único e perfil de acesso. Cadastrar um advogado
--                    externo ali criaria uma conta de login no sistema.
--   `OrgaoProtocolo` é pessoa jurídica. O escritório é uma organização; o advogado
--                    não é. Pendurar OAB numa empresa é dizer que a inscrição é dela.
--   `Fornecedor`     é legado — 1 linha, contra 241 em Órgãos e Organizações.
--
-- ─── POR QUE O REGISTRO EM TABELA SEPARADA ──────────────────────────────────
-- Colunas `oab` e `oabUf` resolveriam OAB e travariam o resto. O mesmo advogado pode
-- ter inscrição em mais de uma UF; um tradutor juramentado tem matrícula na Junta
-- Comercial, que é outro tipo de registro com outra jurisdição. Aqui "OAB" é um
-- VALOR de `tipo`, não uma estrutura — e a próxima categoria não pede migration.
--
-- ─── O QUE MUDA NO PACOTE ───────────────────────────────────────────────────
-- Ganha `profissionalId` (referência, não nome copiado) e `tipo` passa a aceitar
-- NULL: o pedido pode ser aberto agrupando as divergências que vão juntas antes de
-- alguém decidir se o caminho é judicial ou administrativo — que é o que o passo
-- "Definir modo" faz. `processoNum`, que já existia, fica sendo o número do processo
-- judicial: o pacote É o procedimento, e não há entidade "processo judicial" no
-- sistema para criar vazia só para guardar uma string.
--
-- ADITIVA. Nada é apagado, e `tipo` só afrouxa — o que já tem valor continua tendo.

CREATE TABLE IF NOT EXISTS "Profissional" (
  "id"            SERIAL       PRIMARY KEY,
  "nome"          VARCHAR(200) NOT NULL,
  "categoria"     VARCHAR(40)  NOT NULL,
  "email"         VARCHAR(200),
  "telefone"      VARCHAR(60),
  "organizacaoId" INTEGER,
  "observacoes"   TEXT,
  "ativo"         BOOLEAN      NOT NULL DEFAULT true,
  "criadoEm"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "atualizadoEm"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "RegistroProfissional" (
  "id"              SERIAL       PRIMARY KEY,
  "profissionalId"  INTEGER      NOT NULL,
  "tipo"            VARCHAR(20)  NOT NULL,
  "numero"          VARCHAR(40)  NOT NULL,
  "jurisdicao"      VARCHAR(40),
  "orgaoDeClasseId" INTEGER,
  "ativo"           BOOLEAN      NOT NULL DEFAULT true,
  "criadoEm"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "atualizadoEm"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

DO $$ BEGIN
  ALTER TABLE "Profissional" ADD CONSTRAINT "Profissional_organizacaoId_fkey"
    FOREIGN KEY ("organizacaoId") REFERENCES "OrgaoProtocolo"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "RegistroProfissional" ADD CONSTRAINT "RegistroProfissional_profissionalId_fkey"
    FOREIGN KEY ("profissionalId") REFERENCES "Profissional"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "RegistroProfissional" ADD CONSTRAINT "RegistroProfissional_orgaoDeClasseId_fkey"
    FOREIGN KEY ("orgaoDeClasseId") REFERENCES "OrgaoProtocolo"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "Profissional_categoria_idx"     ON "Profissional"("categoria");
CREATE INDEX IF NOT EXISTS "Profissional_organizacaoId_idx" ON "Profissional"("organizacaoId");
CREATE INDEX IF NOT EXISTS "Profissional_ativo_idx"         ON "Profissional"("ativo");
CREATE INDEX IF NOT EXISTS "RegistroProfissional_profissionalId_idx" ON "RegistroProfissional"("profissionalId");

-- A MESMA INSCRIÇÃO NÃO SE REPETE: "OAB 123456 SP" identifica uma pessoa só.
CREATE UNIQUE INDEX IF NOT EXISTS "RegistroProfissional_tipo_numero_jurisdicao_key"
  ON "RegistroProfissional"("tipo", "numero", "jurisdicao");

ALTER TABLE "RetificacaoPacote" ADD COLUMN IF NOT EXISTS "profissionalId" INTEGER;

DO $$ BEGIN
  ALTER TABLE "RetificacaoPacote" ADD CONSTRAINT "RetificacaoPacote_profissionalId_fkey"
    FOREIGN KEY ("profissionalId") REFERENCES "Profissional"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "RetificacaoPacote_profissionalId_idx" ON "RetificacaoPacote"("profissionalId");

-- `tipo` PASSA A ACEITAR NULL. Só afrouxa: nenhuma linha existente é tocada.
ALTER TABLE "RetificacaoPacote" ALTER COLUMN "tipo" DROP NOT NULL;
