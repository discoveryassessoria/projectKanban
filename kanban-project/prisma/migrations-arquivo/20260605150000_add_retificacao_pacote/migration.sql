-- CreateTable
CREATE TABLE "RetificacaoPacote" (
    "id" SERIAL NOT NULL,
    "processoId" INTEGER NOT NULL,
    "num" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'em_preparacao',
    "currentStep" TEXT NOT NULL DEFAULT 'definir_estrategia',
    "motivo" TEXT,
    "prioridade" TEXT DEFAULT 'Média',
    "proxAcao" TEXT,
    "processoNum" TEXT,
    "tribunal" TEXT,
    "vara" TEXT,
    "comarca" TEXT,
    "advogado" TEXT,
    "oab" TEXT,
    "statusProc" TEXT,
    "cartorio" TEXT,
    "canal" TEXT,
    "protocolo" TEXT,
    "dataProtocolo" TEXT,
    "atendente" TEXT,
    "prazo" TEXT,
    "statusAdm" TEXT,
    "workflow" JSONB,
    "divergenceIds" JSONB,
    "affectedDocIds" JSONB,
    "movements" JSONB,
    "attachments" JSONB,
    "validacao" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "RetificacaoPacote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RetificacaoPacote_processoId_idx" ON "RetificacaoPacote"("processoId");

-- AddForeignKey
ALTER TABLE "RetificacaoPacote" ADD CONSTRAINT "RetificacaoPacote_processoId_fkey" FOREIGN KEY ("processoId") REFERENCES "Processo"("id") ON DELETE CASCADE ON UPDATE CASCADE;