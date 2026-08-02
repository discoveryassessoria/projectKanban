-- CreateEnum
CREATE TYPE "RegraDocumentalStatus" AS ENUM ('RASCUNHO', 'PUBLICADA', 'INATIVA', 'ARQUIVADA');

-- CreateEnum
CREATE TYPE "ObrigatoriedadeRegra" AS ENUM ('OBRIGATORIA', 'OPCIONAL');

-- CreateEnum
CREATE TYPE "PublicoAlvoRegra" AS ENUM ('REQUERENTE', 'CONTRATANTE', 'PESSOA_DA_ARVORE_COM_DOCUMENTACAO', 'PESSOA_DA_LINHA_RETA', 'PESSOA_FORA_DA_LINHA_RETA', 'TODAS_AS_PESSOAS_DA_ARVORE');

-- AlterTable
ALTER TABLE "MatrizDocumental" ADD COLUMN     "antecedenciaRenovacaoDias" INTEGER,
ADD COLUMN     "atualizadoPor" INTEGER,
ADD COLUMN     "categoriaCode" VARCHAR(40),
ADD COLUMN     "codigo" VARCHAR(60),
ADD COLUMN     "condicoes" JSONB,
ADD COLUMN     "continuaObrigatorioNasFasesSeguintes" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "criadoPor" INTEGER,
ADD COLUMN     "descricao" TEXT,
ADD COLUMN     "exigeDataEmissao" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "faseBloqueio" VARCHAR(60),
ADD COLUMN     "faseExigencia" VARCHAR(60),
ADD COLUMN     "faseFinalExigencia" VARCHAR(60),
ADD COLUMN     "modalidadeId" INTEGER,
ADD COLUMN     "nome" VARCHAR(200),
ADD COLUMN     "obrigatoriedade" "ObrigatoriedadeRegra" NOT NULL DEFAULT 'OBRIGATORIA',
ADD COLUMN     "obrigatorioAteFinalProcesso" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "paisCode" VARCHAR(8),
ADD COLUMN     "possuiValidade" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "prioridade" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "publicadoEm" TIMESTAMP(3),
ADD COLUMN     "publicadoPor" INTEGER,
ADD COLUMN     "publicoAlvo" "PublicoAlvoRegra" NOT NULL DEFAULT 'PESSOA_DA_LINHA_RETA',
ADD COLUMN     "regiaoCode" VARCHAR(16),
ADD COLUMN     "renovarQuandoExpirado" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "status" "RegraDocumentalStatus" NOT NULL DEFAULT 'RASCUNHO',
ADD COLUMN     "tipoProcessoVersao" INTEGER,
ADD COLUMN     "validadeDias" INTEGER,
ADD COLUMN     "vigenciaFim" TIMESTAMP(3),
ADD COLUMN     "vigenciaInicio" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "MatrizDocumental_status_idx" ON "MatrizDocumental"("status");

-- CreateIndex
CREATE INDEX "MatrizDocumental_codigo_idx" ON "MatrizDocumental"("codigo");

-- CreateIndex
CREATE INDEX "MatrizDocumental_publicoAlvo_idx" ON "MatrizDocumental"("publicoAlvo");

-- CreateIndex
CREATE UNIQUE INDEX "MatrizDocumental_codigo_versao_key" ON "MatrizDocumental"("codigo", "versao");


-- ============================================================
-- ADAPTAÇÃO DOS REGISTROS ANTIGOS (dados existentes) — seção 14.
-- Mapeamento INEQUÍVOCO dos campos legados para a estrutura canônica.
-- NÃO publica: todos permanecem status=RASCUNHO (default) até revisão humana.
-- Nenhum dado é apagado; apenas preenche as novas colunas.
-- ============================================================
UPDATE "MatrizDocumental" SET
  "obrigatoriedade" = CASE WHEN "required" THEN 'OBRIGATORIA'::"ObrigatoriedadeRegra" ELSE 'OPCIONAL'::"ObrigatoriedadeRegra" END,
  "publicoAlvo" = CASE "target"
    WHEN 'direct_line_person' THEN 'PESSOA_DA_LINHA_RETA'::"PublicoAlvoRegra"
    WHEN 'non_direct_person'  THEN 'PESSOA_FORA_DA_LINHA_RETA'::"PublicoAlvoRegra"
    WHEN 'applicant'          THEN 'REQUERENTE'::"PublicoAlvoRegra"
    ELSE 'PESSOA_DA_LINHA_RETA'::"PublicoAlvoRegra"
  END,
  "faseExigencia" = "phaseKey",
  "faseBloqueio"  = CASE WHEN "blocksPhaseCompletion" THEN "phaseKey" ELSE NULL END,
  "codigo" = 'MDX_' || "id"::text,
  "nome"   = COALESCE("nome", "documentTypeCode")
WHERE "codigo" IS NULL;
