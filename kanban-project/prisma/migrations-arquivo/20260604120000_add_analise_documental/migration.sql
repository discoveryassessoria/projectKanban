-- CreateTable
CREATE TABLE "AnaliseDocumental" (
    "id" SERIAL NOT NULL,
    "processoId" INTEGER NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'pendente',
    "currentStep" VARCHAR(30) NOT NULL DEFAULT 'comparacao_ia',
    "totalDocumentos" INTEGER NOT NULL DEFAULT 0,
    "documentosAnalisados" INTEGER NOT NULL DEFAULT 0,
    "camposComparados" INTEGER NOT NULL DEFAULT 0,
    "resumoIA" TEXT,
    "decisaoJuridica" VARCHAR(20),
    "requerRetificacao" BOOLEAN NOT NULL DEFAULT false,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AnaliseDocumental_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Divergencia" (
    "id" SERIAL NOT NULL,
    "analiseId" INTEGER NOT NULL,
    "pessoaId" INTEGER,
    "pessoaNome" VARCHAR(200) NOT NULL,
    "geracao" INTEGER,
    "linhaReta" BOOLEAN NOT NULL DEFAULT true,
    "documentoId" INTEGER,
    "documentoTitulo" VARCHAR(200) NOT NULL,
    "dataDocumento" VARCHAR(20),
    "campo" VARCHAR(60) NOT NULL,
    "campoLabel" VARCHAR(120) NOT NULL,
    "valorArvore" VARCHAR(300),
    "valorDocumento" VARCHAR(300),
    "tipo" VARCHAR(40) NOT NULL,
    "severidade" VARCHAR(10) NOT NULL,
    "sugestaoIA" VARCHAR(300),
    "motivoIA" TEXT,
    "impacto" VARCHAR(300),
    "requerRetificacaoIA" BOOLEAN NOT NULL DEFAULT false,
    "status" VARCHAR(20) NOT NULL DEFAULT 'pendente',
    "decididoPorId" INTEGER,
    "decididoEm" TIMESTAMP(3),
    "notas" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Divergencia_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AnaliseDocumental_processoId_key" ON "AnaliseDocumental"("processoId");

-- CreateIndex
CREATE INDEX "AnaliseDocumental_processoId_idx" ON "AnaliseDocumental"("processoId");

-- CreateIndex
CREATE INDEX "AnaliseDocumental_status_idx" ON "AnaliseDocumental"("status");

-- CreateIndex
CREATE INDEX "Divergencia_analiseId_idx" ON "Divergencia"("analiseId");

-- CreateIndex
CREATE INDEX "Divergencia_status_idx" ON "Divergencia"("status");

-- CreateIndex
CREATE INDEX "Divergencia_severidade_idx" ON "Divergencia"("severidade");

-- AddForeignKey
ALTER TABLE "AnaliseDocumental" ADD CONSTRAINT "AnaliseDocumental_processoId_fkey" FOREIGN KEY ("processoId") REFERENCES "Processo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Divergencia" ADD CONSTRAINT "Divergencia_analiseId_fkey" FOREIGN KEY ("analiseId") REFERENCES "AnaliseDocumental"("id") ON DELETE CASCADE ON UPDATE CASCADE;