-- ORGANIZAÇÃO ÚNICA — funções, identidade fiscal e dados financeiros.
--
-- ARQUITETURA PERMANENTE: o módulo Órgãos e Organizações é a ÚNICA fonte de
-- verdade das organizações do Discovery. A mesma entidade existe UMA vez e
-- exerce N funções (Órgão, Fornecedor, Parceiro, Correspondente, Cliente
-- Corporativo). Classificar nunca é criar cadastro novo — por isso "Fornecedor"
-- é FUNÇÃO desta tabela, não uma tabela paralela.
--
-- 100% ADITIVO E IDEMPOTENTE. Nenhuma coluna existente é alterada ou apagada.

-- ── funções ────────────────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE "FuncaoOrganizacao" AS ENUM ('ORGAO', 'FORNECEDOR', 'PARCEIRO', 'CORRESPONDENTE', 'CLIENTE_CORPORATIVO');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "OrgaoProtocolo" ADD COLUMN IF NOT EXISTS "funcoes" "FuncaoOrganizacao"[] NOT NULL DEFAULT '{}';

-- ── localização de 2º nível ────────────────────────────────────────────────
ALTER TABLE "OrgaoProtocolo" ADD COLUMN IF NOT EXISTS "provincia" VARCHAR(80);

-- ── identidade fiscal: a chave FORTE de deduplicação ───────────────────────
ALTER TABLE "OrgaoProtocolo" ADD COLUMN IF NOT EXISTS "identificacaoFiscal" VARCHAR(40);
ALTER TABLE "OrgaoProtocolo" ADD COLUMN IF NOT EXISTS "tipoIdentificacaoFiscal" VARCHAR(20);
CREATE UNIQUE INDEX IF NOT EXISTS "OrgaoProtocolo_identificacaoFiscal_key" ON "OrgaoProtocolo"("identificacaoFiscal");

-- ── dados financeiros do fornecedor ────────────────────────────────────────
ALTER TABLE "OrgaoProtocolo" ADD COLUMN IF NOT EXISTS "formaPagamento" VARCHAR(60);
ALTER TABLE "OrgaoProtocolo" ADD COLUMN IF NOT EXISTS "chavePix" VARCHAR(140);
ALTER TABLE "OrgaoProtocolo" ADD COLUMN IF NOT EXISTS "tipoChavePix" VARCHAR(20);
ALTER TABLE "OrgaoProtocolo" ADD COLUMN IF NOT EXISTS "banco" VARCHAR(120);
ALTER TABLE "OrgaoProtocolo" ADD COLUMN IF NOT EXISTS "agencia" VARCHAR(20);
ALTER TABLE "OrgaoProtocolo" ADD COLUMN IF NOT EXISTS "conta" VARCHAR(30);
ALTER TABLE "OrgaoProtocolo" ADD COLUMN IF NOT EXISTS "tipoConta" VARCHAR(20);
ALTER TABLE "OrgaoProtocolo" ADD COLUMN IF NOT EXISTS "prazoPagamentoDias" INTEGER;
ALTER TABLE "OrgaoProtocolo" ADD COLUMN IF NOT EXISTS "contatoFinanceiro" VARCHAR(200);
ALTER TABLE "OrgaoProtocolo" ADD COLUMN IF NOT EXISTS "observacoesFinanceiras" TEXT;
ALTER TABLE "OrgaoProtocolo" ADD COLUMN IF NOT EXISTS "statusFinanceiro" VARCHAR(20);

CREATE INDEX IF NOT EXISTS "OrgaoProtocolo_provincia_idx" ON "OrgaoProtocolo"("provincia");
CREATE INDEX IF NOT EXISTS "OrgaoProtocolo_funcoes_idx" ON "OrgaoProtocolo" USING GIN ("funcoes");

-- Toda organização já cadastrada é, no mínimo, um ÓRGÃO — a função nasce
-- preenchida para ninguém ficar sem classificação funcional.
UPDATE "OrgaoProtocolo" SET "funcoes" = ARRAY['ORGAO']::"FuncaoOrganizacao"[]
 WHERE "funcoes" = '{}'::"FuncaoOrganizacao"[];
