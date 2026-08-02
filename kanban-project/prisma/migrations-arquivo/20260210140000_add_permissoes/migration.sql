-- CreateTable
CREATE TABLE "Perfil" (
    "id" SERIAL NOT NULL,
    "nome" VARCHAR(50) NOT NULL,
    "descricao" VARCHAR(200),
    "permissoes" JSONB NOT NULL,
    "sistema" BOOLEAN NOT NULL DEFAULT false,
    "cor" VARCHAR(7),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Perfil_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Perfil_nome_key" ON "Perfil"("nome");

-- AlterTable Usuario
ALTER TABLE "Usuario" ADD COLUMN "perfilId" INTEGER;
ALTER TABLE "Usuario" ADD COLUMN "permissoesCustom" JSONB;

-- CreateIndex
CREATE INDEX "Usuario_perfilId_idx" ON "Usuario"("perfilId");

-- AddForeignKey
ALTER TABLE "Usuario" ADD CONSTRAINT "Usuario_perfilId_fkey" FOREIGN KEY ("perfilId") REFERENCES "Perfil"("id") ON DELETE SET NULL ON UPDATE CASCADE;