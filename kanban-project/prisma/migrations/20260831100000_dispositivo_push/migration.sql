-- CreateTable
CREATE TABLE "DispositivoPush" (
    "id" SERIAL NOT NULL,
    "clienteAuthId" INTEGER NOT NULL,
    "expoPushToken" VARCHAR(255) NOT NULL,
    "plataforma" VARCHAR(20),
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DispositivoPush_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DispositivoPush_expoPushToken_key" ON "DispositivoPush"("expoPushToken");

-- CreateIndex
CREATE INDEX "DispositivoPush_clienteAuthId_idx" ON "DispositivoPush"("clienteAuthId");

-- AddForeignKey
ALTER TABLE "DispositivoPush" ADD CONSTRAINT "DispositivoPush_clienteAuthId_fkey" FOREIGN KEY ("clienteAuthId") REFERENCES "ClienteAuth"("id") ON DELETE CASCADE ON UPDATE CASCADE;
