-- ════════════════════════════════════════════════════════════════════════════
-- REPOSITÓRIO OFICIAL DE MODELOS DOCUMENTAIS — migration ADITIVA.
--
-- Cria quatro tabelas e quatro enums NOVOS. Não altera, não renomeia e não
-- remove nada do que já existe: nenhuma linha desta migration toca Documento,
-- DocumentoArquivo, PhaseWorkflowInstance, Tarefa, Processo ou qualquer objeto
-- da baseline congelada — as únicas referências a tabelas antigas são FOREIGN
-- KEYS saindo das tabelas novas.
--
-- Sem DROP. Sem TRUNCATE. Sem DELETE. Sem reset. Idempotente por IF NOT EXISTS
-- nos objetos que o Prisma não cria condicionalmente (índices parciais e CHECK).
-- ════════════════════════════════════════════════════════════════════════════

-- CreateEnum
CREATE TYPE "ModeloDocumentalCategoria" AS ENUM ('PROCURACAO', 'CONTRATO', 'DECLARACAO', 'REQUERIMENTO', 'FORMULARIO', 'AUTORIZACAO', 'NOTIFICACAO', 'OUTRO');

-- CreateEnum
CREATE TYPE "ModeloDocumentalVersaoStatus" AS ENUM ('RASCUNHO', 'PUBLICADA', 'REVOGADA');

-- CreateEnum
CREATE TYPE "DocumentoGeradoStatus" AS ENUM ('VIGENTE', 'INVALIDADO');

-- CreateEnum
CREATE TYPE "DocumentoGeradoVersaoStatus" AS ENUM ('GERADA', 'VIGENTE', 'SUBSTITUIDA', 'INVALIDADA');

-- CreateTable
CREATE TABLE "ModeloDocumental" (
    "id" SERIAL NOT NULL,
    "codigo" VARCHAR(40) NOT NULL,
    "nome" VARCHAR(200) NOT NULL,
    "descricao" TEXT,
    "categoria" "ModeloDocumentalCategoria" NOT NULL,
    "documentTypeId" INTEGER NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criadoPorId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ModeloDocumental_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModeloDocumentalVersao" (
    "id" SERIAL NOT NULL,
    "modeloId" INTEGER NOT NULL,
    "numero" INTEGER NOT NULL,
    "arquivoChave" VARCHAR(400) NOT NULL,
    "arquivoNome" VARCHAR(300) NOT NULL,
    "arquivoMime" VARCHAR(120),
    "arquivoTamanho" INTEGER,
    "checksum" VARCHAR(80) NOT NULL,
    "status" "ModeloDocumentalVersaoStatus" NOT NULL DEFAULT 'RASCUNHO',
    "placeholders" JSONB NOT NULL,
    "obrigatorios" JSONB NOT NULL,
    "opcionais" JSONB NOT NULL,
    "dadosFixosDeclarados" JSONB,
    "observacao" TEXT,
    "criadoPorId" INTEGER,
    "publicadoEm" TIMESTAMP(3),
    "publicadoPorId" INTEGER,
    "revogadoEm" TIMESTAMP(3),
    "revogadoPorId" INTEGER,
    "vigenteDe" TIMESTAMP(3),
    "vigenteAte" TIMESTAMP(3),
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ModeloDocumentalVersao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentoGerado" (
    "id" SERIAL NOT NULL,
    "modeloId" INTEGER NOT NULL,
    "documentTypeId" INTEGER NOT NULL,
    "contratanteId" INTEGER,
    "requerenteId" INTEGER,
    "pessoaId" INTEGER,
    "processoId" INTEGER,
    "servicoId" INTEGER,
    "documentoId" INTEGER,
    "status" "DocumentoGeradoStatus" NOT NULL DEFAULT 'VIGENTE',
    "chaveIdentidade" VARCHAR(200) NOT NULL,
    "criadoPorId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DocumentoGerado_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentoGeradoVersao" (
    "id" SERIAL NOT NULL,
    "documentoGeradoId" INTEGER NOT NULL,
    "numero" INTEGER NOT NULL,
    "modeloVersaoId" INTEGER NOT NULL,
    "docxChave" VARCHAR(400) NOT NULL,
    "docxNome" VARCHAR(300) NOT NULL,
    "docxChecksum" VARCHAR(80) NOT NULL,
    "docxTamanho" INTEGER,
    "pdfChave" VARCHAR(400) NOT NULL,
    "pdfNome" VARCHAR(300) NOT NULL,
    "pdfChecksum" VARCHAR(80) NOT NULL,
    "pdfTamanho" INTEGER,
    "dadosSnapshot" JSONB NOT NULL,
    "status" "DocumentoGeradoVersaoStatus" NOT NULL DEFAULT 'GERADA',
    "geradoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "geradoPorId" INTEGER,
    "substituidaEm" TIMESTAMP(3),
    "substituidaPorId" INTEGER,
    "invalidadaEm" TIMESTAMP(3),
    "invalidadaPorId" INTEGER,
    "motivoInvalidacao" VARCHAR(300),
    "chaveIdempotencia" VARCHAR(200) NOT NULL,

    CONSTRAINT "DocumentoGeradoVersao_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ModeloDocumental_codigo_key" ON "ModeloDocumental"("codigo");

-- CreateIndex
CREATE INDEX "ModeloDocumental_documentTypeId_idx" ON "ModeloDocumental"("documentTypeId");

-- CreateIndex
CREATE INDEX "ModeloDocumental_categoria_idx" ON "ModeloDocumental"("categoria");

-- CreateIndex
CREATE INDEX "ModeloDocumental_ativo_idx" ON "ModeloDocumental"("ativo");

-- CreateIndex
CREATE INDEX "ModeloDocumentalVersao_modeloId_status_idx" ON "ModeloDocumentalVersao"("modeloId", "status");

-- CreateIndex
CREATE INDEX "ModeloDocumentalVersao_checksum_idx" ON "ModeloDocumentalVersao"("checksum");

-- CreateIndex
CREATE UNIQUE INDEX "ModeloDocumentalVersao_modeloId_numero_key" ON "ModeloDocumentalVersao"("modeloId", "numero");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentoGerado_chaveIdentidade_key" ON "DocumentoGerado"("chaveIdentidade");

-- CreateIndex
CREATE INDEX "DocumentoGerado_contratanteId_idx" ON "DocumentoGerado"("contratanteId");

-- CreateIndex
CREATE INDEX "DocumentoGerado_requerenteId_idx" ON "DocumentoGerado"("requerenteId");

-- CreateIndex
CREATE INDEX "DocumentoGerado_pessoaId_idx" ON "DocumentoGerado"("pessoaId");

-- CreateIndex
CREATE INDEX "DocumentoGerado_processoId_idx" ON "DocumentoGerado"("processoId");

-- CreateIndex
CREATE INDEX "DocumentoGerado_documentTypeId_idx" ON "DocumentoGerado"("documentTypeId");

-- CreateIndex
CREATE INDEX "DocumentoGerado_documentoId_idx" ON "DocumentoGerado"("documentoId");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentoGeradoVersao_substituidaPorId_key" ON "DocumentoGeradoVersao"("substituidaPorId");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentoGeradoVersao_chaveIdempotencia_key" ON "DocumentoGeradoVersao"("chaveIdempotencia");

-- CreateIndex
CREATE INDEX "DocumentoGeradoVersao_modeloVersaoId_idx" ON "DocumentoGeradoVersao"("modeloVersaoId");

-- CreateIndex
CREATE INDEX "DocumentoGeradoVersao_status_idx" ON "DocumentoGeradoVersao"("status");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentoGeradoVersao_documentoGeradoId_numero_key" ON "DocumentoGeradoVersao"("documentoGeradoId", "numero");

-- AddForeignKey
ALTER TABLE "ModeloDocumental" ADD CONSTRAINT "ModeloDocumental_documentTypeId_fkey" FOREIGN KEY ("documentTypeId") REFERENCES "TipoDocumentoCadastro"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModeloDocumental" ADD CONSTRAINT "ModeloDocumental_criadoPorId_fkey" FOREIGN KEY ("criadoPorId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModeloDocumentalVersao" ADD CONSTRAINT "ModeloDocumentalVersao_modeloId_fkey" FOREIGN KEY ("modeloId") REFERENCES "ModeloDocumental"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModeloDocumentalVersao" ADD CONSTRAINT "ModeloDocumentalVersao_criadoPorId_fkey" FOREIGN KEY ("criadoPorId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModeloDocumentalVersao" ADD CONSTRAINT "ModeloDocumentalVersao_publicadoPorId_fkey" FOREIGN KEY ("publicadoPorId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModeloDocumentalVersao" ADD CONSTRAINT "ModeloDocumentalVersao_revogadoPorId_fkey" FOREIGN KEY ("revogadoPorId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentoGerado" ADD CONSTRAINT "DocumentoGerado_modeloId_fkey" FOREIGN KEY ("modeloId") REFERENCES "ModeloDocumental"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentoGerado" ADD CONSTRAINT "DocumentoGerado_documentTypeId_fkey" FOREIGN KEY ("documentTypeId") REFERENCES "TipoDocumentoCadastro"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentoGerado" ADD CONSTRAINT "DocumentoGerado_contratanteId_fkey" FOREIGN KEY ("contratanteId") REFERENCES "Contratante"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentoGerado" ADD CONSTRAINT "DocumentoGerado_requerenteId_fkey" FOREIGN KEY ("requerenteId") REFERENCES "Requerente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentoGerado" ADD CONSTRAINT "DocumentoGerado_pessoaId_fkey" FOREIGN KEY ("pessoaId") REFERENCES "Pessoa"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentoGerado" ADD CONSTRAINT "DocumentoGerado_processoId_fkey" FOREIGN KEY ("processoId") REFERENCES "Processo"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentoGerado" ADD CONSTRAINT "DocumentoGerado_servicoId_fkey" FOREIGN KEY ("servicoId") REFERENCES "ServicoProduto"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentoGerado" ADD CONSTRAINT "DocumentoGerado_documentoId_fkey" FOREIGN KEY ("documentoId") REFERENCES "Documento"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentoGerado" ADD CONSTRAINT "DocumentoGerado_criadoPorId_fkey" FOREIGN KEY ("criadoPorId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentoGeradoVersao" ADD CONSTRAINT "DocumentoGeradoVersao_documentoGeradoId_fkey" FOREIGN KEY ("documentoGeradoId") REFERENCES "DocumentoGerado"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentoGeradoVersao" ADD CONSTRAINT "DocumentoGeradoVersao_modeloVersaoId_fkey" FOREIGN KEY ("modeloVersaoId") REFERENCES "ModeloDocumentalVersao"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentoGeradoVersao" ADD CONSTRAINT "DocumentoGeradoVersao_geradoPorId_fkey" FOREIGN KEY ("geradoPorId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentoGeradoVersao" ADD CONSTRAINT "DocumentoGeradoVersao_substituidaPorId_fkey" FOREIGN KEY ("substituidaPorId") REFERENCES "DocumentoGeradoVersao"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentoGeradoVersao" ADD CONSTRAINT "DocumentoGeradoVersao_invalidadaPorId_fkey" FOREIGN KEY ("invalidadaPorId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ── TRAVAS DE DOMÍNIO NO BANCO ─────────────────────────────────────────────
-- As invariantes abaixo não existem no schema Prisma porque Prisma não expressa
-- CHECK nem índice único parcial. Elas moram aqui porque precisam valer mesmo
-- para escrita fora da aplicação.

-- Exatamente UM outorgante por documento gerado: ou contratante, ou requerente.
ALTER TABLE "DocumentoGerado"
  ADD CONSTRAINT "DocumentoGerado_outorgante_exatamente_um"
  CHECK (("contratanteId" IS NOT NULL)::int + ("requerenteId" IS NOT NULL)::int = 1);

-- UMA versão PUBLICADA por modelo. É o que impede "outra versão publicada
-- conflitante" — garantido pelo banco, não pela ordem das chamadas.
CREATE UNIQUE INDEX IF NOT EXISTS "ModeloDocumentalVersao_uma_publicada_por_modelo"
  ON "ModeloDocumentalVersao" ("modeloId")
  WHERE "status" = 'PUBLICADA';

-- UMA versão VIGENTE por documento gerado (pessoa + tipo + processo, via o
-- agregado). Nova geração só vira vigente depois que a anterior é substituída.
CREATE UNIQUE INDEX IF NOT EXISTS "DocumentoGeradoVersao_uma_vigente_por_documento"
  ON "DocumentoGeradoVersao" ("documentoGeradoId")
  WHERE "status" = 'VIGENTE';
