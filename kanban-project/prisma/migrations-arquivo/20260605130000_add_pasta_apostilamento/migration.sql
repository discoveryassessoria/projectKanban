-- CreateTable
CREATE TABLE "PastaApostilamento" (
    "id" SERIAL NOT NULL,
    "processoId" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'em_andamento',
    "currentStep" TEXT NOT NULL DEFAULT 'montar_pasta_apostilamento',
    "destinationCountry" TEXT,
    "apostilleType" TEXT,
    "authorityName" TEXT,
    "attendant" TEXT,
    "cost" TEXT,
    "trackingCode" TEXT,
    "expectedDate" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "receivedAt" TIMESTAMP(3),
    "validatedAt" TIMESTAMP(3),
    "validatedById" INTEGER,
    "workflow" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PastaApostilamento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PastaApostilamentoDocumento" (
    "id" SERIAL NOT NULL,
    "pastaApostilamentoId" INTEGER NOT NULL,
    "documentoId" INTEGER NOT NULL,
    "pessoaNome" TEXT NOT NULL DEFAULT '',
    "documentoTitulo" TEXT NOT NULL DEFAULT '',
    "origem" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'pendente',
    "apostilledFile" TEXT,
    "apostilleNumber" TEXT,
    "apostilleDate" TEXT,
    "issuingAuthority" TEXT,
    "conferenceResult" TEXT,
    "validationDecision" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PastaApostilamentoDocumento_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PastaApostilamento_processoId_key" ON "PastaApostilamento"("processoId");

-- CreateIndex
CREATE INDEX "PastaApostilamentoDocumento_pastaApostilamentoId_idx" ON "PastaApostilamentoDocumento"("pastaApostilamentoId");

-- AddForeignKey
ALTER TABLE "PastaApostilamento" ADD CONSTRAINT "PastaApostilamento_processoId_fkey" FOREIGN KEY ("processoId") REFERENCES "Processo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PastaApostilamentoDocumento" ADD CONSTRAINT "PastaApostilamentoDocumento_pastaApostilamentoId_fkey" FOREIGN KEY ("pastaApostilamentoId") REFERENCES "PastaApostilamento"("id") ON DELETE CASCADE ON UPDATE CASCADE;