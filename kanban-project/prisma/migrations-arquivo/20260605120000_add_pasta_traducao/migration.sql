-- CreateTable
CREATE TABLE "PastaTraducao" (
    "id" SERIAL NOT NULL,
    "processoId" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'em_andamento',
    "currentStep" TEXT NOT NULL DEFAULT 'montar_pasta_traducao',
    "sourceLanguage" TEXT NOT NULL DEFAULT 'Português',
    "targetLanguage" TEXT NOT NULL DEFAULT 'Italiano',
    "translatorName" TEXT,
    "translatorEmail" TEXT,
    "cost" TEXT,
    "expectedDate" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "receivedAt" TIMESTAMP(3),
    "validatedAt" TIMESTAMP(3),
    "validatedById" INTEGER,
    "workflow" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PastaTraducao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PastaTraducaoDocumento" (
    "id" SERIAL NOT NULL,
    "pastaTraducaoId" INTEGER NOT NULL,
    "documentoId" INTEGER NOT NULL,
    "pessoaNome" TEXT NOT NULL DEFAULT '',
    "documentoTitulo" TEXT NOT NULL DEFAULT '',
    "origem" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'pendente',
    "translatedFile" TEXT,
    "conferenceResult" TEXT,
    "validationDecision" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PastaTraducaoDocumento_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PastaTraducao_processoId_key" ON "PastaTraducao"("processoId");

-- CreateIndex
CREATE INDEX "PastaTraducaoDocumento_pastaTraducaoId_idx" ON "PastaTraducaoDocumento"("pastaTraducaoId");

-- AddForeignKey
ALTER TABLE "PastaTraducao" ADD CONSTRAINT "PastaTraducao_processoId_fkey" FOREIGN KEY ("processoId") REFERENCES "Processo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PastaTraducaoDocumento" ADD CONSTRAINT "PastaTraducaoDocumento_pastaTraducaoId_fkey" FOREIGN KEY ("pastaTraducaoId") REFERENCES "PastaTraducao"("id") ON DELETE CASCADE ON UPDATE CASCADE;