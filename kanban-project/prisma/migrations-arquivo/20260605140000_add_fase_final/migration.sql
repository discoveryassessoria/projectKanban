-- CreateTable
CREATE TABLE "FaseFinal" (
    "id" SERIAL NOT NULL,
    "processoId" INTEGER NOT NULL,
    "faseKey" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'em_andamento',
    "currentStep" TEXT NOT NULL,
    "workflow" JSONB,
    "data" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "FaseFinal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FaseFinal_processoId_faseKey_key" ON "FaseFinal"("processoId", "faseKey");

-- AddForeignKey
ALTER TABLE "FaseFinal" ADD CONSTRAINT "FaseFinal_processoId_fkey" FOREIGN KEY ("processoId") REFERENCES "Processo"("id") ON DELETE CASCADE ON UPDATE CASCADE;