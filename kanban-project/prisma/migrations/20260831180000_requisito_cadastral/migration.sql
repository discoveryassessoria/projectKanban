-- ============================================================================
-- REQUISITO CADASTRAL — a obrigatoriedade de DADO vira cadastro
-- ----------------------------------------------------------------------------
-- ADITIVA. Nada é removido.
--
-- O Discovery já sabia exigir DOCUMENTO (MatrizDocumental → NecessidadeDocumental
-- → Documento). Não sabia exigir DADO: "e-mail é obrigatório nesta rota" não
-- existia em lugar nenhum além de um `camposObrigatorios: string[]` dentro de um
-- JSON de configuração de passo — sem cadastro, sem aplicabilidade, sem versão.
--
-- Esta tabela guarda a REGRA, nunca o VALOR: o e-mail continua em
-- `Requerente.email`. `campoKey` aponta para o catálogo de campos canônicos em
-- código, que espelha as colunas reais — assim não é possível cadastrar
-- requisito para campo inexistente, que seria obrigação impossível de satisfazer.
--
-- Escopo NULO = "vale para qualquer": um requisito sem país vale para todas as
-- nacionalidades. Evita duplicar a mesma regra por combinação.
-- ============================================================================

CREATE TABLE IF NOT EXISTS "RequisitoCadastral" (
    "id" SERIAL NOT NULL,
    "code" VARCHAR(60) NOT NULL,
    "nome" VARCHAR(160) NOT NULL,
    "descricao" TEXT,
    "campoKey" VARCHAR(80) NOT NULL,
    "obrigatoriedade" "ObrigatoriedadeRegra" NOT NULL DEFAULT 'OBRIGATORIA',
    "bloqueante" BOOLEAN NOT NULL DEFAULT false,
    "publicoAlvo" "PublicoAlvoRegra" NOT NULL DEFAULT 'REQUERENTE',
    "paisId" INTEGER,
    "modalidadeLegalId" INTEGER,
    "itemCatalogoId" INTEGER,
    "idadeMinima" INTEGER,
    "idadeMaxima" INTEGER,
    "versao" INTEGER NOT NULL DEFAULT 1,
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "RequisitoCadastral_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "RequisitoCadastral_code_key" ON "RequisitoCadastral"("code");
CREATE INDEX IF NOT EXISTS "RequisitoCadastral_ativo_idx" ON "RequisitoCadastral"("ativo");
CREATE INDEX IF NOT EXISTS "RequisitoCadastral_campoKey_idx" ON "RequisitoCadastral"("campoKey");
CREATE INDEX IF NOT EXISTS "RequisitoCadastral_paisId_idx" ON "RequisitoCadastral"("paisId");
CREATE INDEX IF NOT EXISTS "RequisitoCadastral_modalidadeLegalId_idx" ON "RequisitoCadastral"("modalidadeLegalId");

DO $$ BEGIN
  ALTER TABLE "RequisitoCadastral" ADD CONSTRAINT "RequisitoCadastral_paisId_fkey"
    FOREIGN KEY ("paisId") REFERENCES "CatalogoPais"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "RequisitoCadastral" ADD CONSTRAINT "RequisitoCadastral_modalidadeLegalId_fkey"
    FOREIGN KEY ("modalidadeLegalId") REFERENCES "ModalidadeLegal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "RequisitoCadastral" ADD CONSTRAINT "RequisitoCadastral_itemCatalogoId_fkey"
    FOREIGN KEY ("itemCatalogoId") REFERENCES "ItemCatalogo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Faixa etária coerente: mínima não pode ser maior que a máxima. Um requisito
-- com faixa impossível nunca se aplicaria a ninguém e ninguém perceberia.
DO $$ BEGIN
  ALTER TABLE "RequisitoCadastral" ADD CONSTRAINT "RequisitoCadastral_faixa_etaria_check"
    CHECK ("idadeMinima" IS NULL OR "idadeMaxima" IS NULL OR "idadeMinima" <= "idadeMaxima");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
