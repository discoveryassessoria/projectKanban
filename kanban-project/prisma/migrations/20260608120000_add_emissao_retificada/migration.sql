CREATE TABLE "EmissaoRetificada" (
  "id" SERIAL NOT NULL,
  "processoId" INTEGER NOT NULL,
  "documentoId" INTEGER NOT NULL,
  "pessoaNome" TEXT NOT NULL,
  "pessoaGen" TEXT,
  "pessoaPapel" TEXT,
  "documentoTitulo" TEXT NOT NULL,
  "correcaoCampo" TEXT,
  "correcaoOld" TEXT,
  "correcaoNovo" TEXT,
  "status" TEXT NOT NULL DEFAULT 'pendente_averbacao',
  "nextAction" TEXT NOT NULL DEFAULT 'Enviar pedido de averbação ao cartório',
  "workflow" JSONB NOT NULL,
  "retifiedValidated" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EmissaoRetificada_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EmissaoRetificada_processoId_documentoId_key" ON "EmissaoRetificada"("processoId", "documentoId");
CREATE INDEX "EmissaoRetificada_processoId_idx" ON "EmissaoRetificada"("processoId");

ALTER TABLE "EmissaoRetificada"
  ADD CONSTRAINT "EmissaoRetificada_processoId_fkey"
  FOREIGN KEY ("processoId") REFERENCES "Processo"("id") ON DELETE CASCADE ON UPDATE CASCADE;