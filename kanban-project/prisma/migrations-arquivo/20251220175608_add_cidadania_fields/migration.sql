/*
  Warnings:

  - Added the required column `updatedAt` to the `Pessoa` table without a default value. This is not possible if the table is not empty.
  - Added the required column `updatedAt` to the `Uniao` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "public"."TipoDocumento" AS ENUM ('CERTIDAO_NASCIMENTO', 'CERTIDAO_NASCIMENTO_INTEIRO_TEOR', 'CERTIDAO_CASAMENTO', 'CERTIDAO_CASAMENTO_INTEIRO_TEOR', 'CERTIDAO_OBITO', 'CERTIDAO_OBITO_INTEIRO_TEOR', 'CERTIDAO_BATISMO', 'CNN', 'CARTA_NATURALIZACAO', 'RG', 'CPF', 'CNH', 'PASSAPORTE_BRASILEIRO', 'TITULO_ELEITOR', 'RESERVISTA', 'PASSAPORTE_ESTRANGEIRO', 'CERTIDAO_CIDADANIA_ESTRANGEIRA', 'COMPROVANTE_RESIDENCIA', 'TRADUCAO_JURAMENTADA', 'APOSTILA_HAIA', 'FOTO_3X4', 'PROCURACAO', 'ARVORE_GENEALOGICA_DOC', 'OUTRO');

-- CreateEnum
CREATE TYPE "public"."StatusDocumento" AS ENUM ('PENDENTE', 'SOLICITADO', 'EM_BUSCA', 'RECEBIDO', 'EM_ANALISE', 'RETIFICANDO', 'EM_TRADUCAO', 'TRADUZIDO', 'EM_APOSTILAMENTO', 'APOSTILADO', 'ENTREGUE', 'INVALIDO', 'NAO_ENCONTRADO');

-- AlterTable
ALTER TABLE "public"."Pessoa" ADD COLUMN     "cidadanias_outras" VARCHAR(200),
ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "data_batismo" TIMESTAMP(3),
ADD COLUMN     "data_chegada" TIMESTAMP(3),
ADD COLUMN     "data_emigracao" TIMESTAMP(3),
ADD COLUMN     "data_naturalizacao" TIMESTAMP(3),
ADD COLUMN     "estado_nasc" VARCHAR(50),
ADD COLUMN     "igreja_batismo" VARCHAR(150),
ADD COLUMN     "local_batismo" VARCHAR(100),
ADD COLUMN     "local_emigracao" VARCHAR(100),
ADD COLUMN     "nacionalidade" VARCHAR(50),
ADD COLUMN     "naturalizado" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "navio" VARCHAR(100),
ADD COLUMN     "pais_destino" VARCHAR(50),
ADD COLUMN     "pais_nasc" VARCHAR(50),
ADD COLUMN     "pais_naturalizacao" VARCHAR(50),
ADD COLUMN     "porto_chegada" VARCHAR(100),
ADD COLUMN     "porto_embarque" VARCHAR(100),
ADD COLUMN     "profissao" VARCHAR(100),
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL,
ADD COLUMN     "vivo" BOOLEAN NOT NULL DEFAULT true,
ALTER COLUMN "local_nasc" SET DATA TYPE VARCHAR(100),
ALTER COLUMN "batizado" SET DATA TYPE VARCHAR(50);

-- AlterTable
ALTER TABLE "public"."Uniao" ADD COLUMN     "cartorio" VARCHAR(200),
ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "data_registro" TIMESTAMP(3),
ADD COLUMN     "estado" VARCHAR(50),
ADD COLUMN     "folha" VARCHAR(20),
ADD COLUMN     "livro" VARCHAR(20),
ADD COLUMN     "local" VARCHAR(100),
ADD COLUMN     "numero_registro" VARCHAR(50),
ADD COLUMN     "observacoes" TEXT,
ADD COLUMN     "pais" VARCHAR(50),
ADD COLUMN     "termo" VARCHAR(30),
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL,
ALTER COLUMN "tipo" SET DATA TYPE VARCHAR(30);

-- CreateTable
CREATE TABLE "public"."Documento" (
    "id" SERIAL NOT NULL,
    "pessoaId" INTEGER NOT NULL,
    "tipo" "public"."TipoDocumento" NOT NULL,
    "status" "public"."StatusDocumento" NOT NULL DEFAULT 'PENDENTE',
    "descricao" VARCHAR(200),
    "cartorio" VARCHAR(200),
    "livro" VARCHAR(20),
    "folha" VARCHAR(20),
    "termo" VARCHAR(30),
    "numero_registro" VARCHAR(50),
    "data_registro" TIMESTAMP(3),
    "cidade_registro" VARCHAR(100),
    "estado_registro" VARCHAR(50),
    "pais_registro" VARCHAR(50),
    "numero" VARCHAR(50),
    "orgao_emissor" VARCHAR(50),
    "data_emissao" TIMESTAMP(3),
    "data_validade" TIMESTAMP(3),
    "arquivo_url" TEXT,
    "arquivo_nome" VARCHAR(200),
    "arquivo_tamanho" INTEGER,
    "arquivo_mime_type" VARCHAR(100),
    "traduzido" BOOLEAN NOT NULL DEFAULT false,
    "tradutor" VARCHAR(150),
    "data_traducao" TIMESTAMP(3),
    "arquivo_traducao_url" TEXT,
    "arquivo_traducao_nome" VARCHAR(200),
    "apostilado" BOOLEAN NOT NULL DEFAULT false,
    "numero_apostila" VARCHAR(50),
    "data_apostila" TIMESTAMP(3),
    "arquivo_apostila_url" TEXT,
    "observacoes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Documento_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Documento_pessoaId_idx" ON "public"."Documento"("pessoaId");

-- CreateIndex
CREATE INDEX "Documento_tipo_idx" ON "public"."Documento"("tipo");

-- CreateIndex
CREATE INDEX "Documento_status_idx" ON "public"."Documento"("status");

-- CreateIndex
CREATE INDEX "Pessoa_arvoreId_idx" ON "public"."Pessoa"("arvoreId");

-- CreateIndex
CREATE INDEX "Pessoa_pais_nasc_idx" ON "public"."Pessoa"("pais_nasc");

-- CreateIndex
CREATE INDEX "Uniao_pessoa1Id_idx" ON "public"."Uniao"("pessoa1Id");

-- CreateIndex
CREATE INDEX "Uniao_pessoa2Id_idx" ON "public"."Uniao"("pessoa2Id");

-- AddForeignKey
ALTER TABLE "public"."Documento" ADD CONSTRAINT "Documento_pessoaId_fkey" FOREIGN KEY ("pessoaId") REFERENCES "public"."Pessoa"("id") ON DELETE CASCADE ON UPDATE CASCADE;
