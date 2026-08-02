-- AlterTable
ALTER TABLE "Documento" ADD COLUMN     "structuredData" JSONB,
ADD COLUMN     "dataStatus" TEXT NOT NULL DEFAULT 'not_filled',
ADD COLUMN     "analysisStatus" TEXT NOT NULL DEFAULT 'not_ready',
ADD COLUMN     "registral" JSONB;