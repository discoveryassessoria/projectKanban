-- AlterTable
ALTER TABLE "IndisponibilidadeOperacional" ADD COLUMN     "sucessorSugeridoId" INTEGER;

-- AlterTable
ALTER TABLE "RelatorioVisao" ADD COLUMN     "compartilhada" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "ComentarioTarefa" (
    "id" SERIAL NOT NULL,
    "tarefaId" INTEGER,
    "familiaId" INTEGER,
    "autorId" INTEGER NOT NULL,
    "texto" TEXT NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ComentarioTarefa_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComentarioMencao" (
    "id" SERIAL NOT NULL,
    "comentarioId" INTEGER NOT NULL,
    "usuarioId" INTEGER NOT NULL,
    "lidaEm" TIMESTAMP(3),

    CONSTRAINT "ComentarioMencao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TorreIndicadorDiario" (
    "id" SERIAL NOT NULL,
    "data" DATE NOT NULL,
    "vencidas" INTEGER NOT NULL,
    "vencemEm7Dias" INTEGER NOT NULL,
    "semDono" INTEGER NOT NULL,
    "aguardandoTerceiro" INTEGER NOT NULL,
    "cobrancasPendentes" INTEGER NOT NULL,
    "escaladas" INTEGER NOT NULL,
    "emRisco" INTEGER NOT NULL,
    "backlogAbertas" INTEGER NOT NULL,
    "backlogFechadasNaSemana" INTEGER NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TorreIndicadorDiario_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ComentarioTarefa_tarefaId_criadoEm_idx" ON "ComentarioTarefa"("tarefaId", "criadoEm");

-- CreateIndex
CREATE INDEX "ComentarioTarefa_familiaId_criadoEm_idx" ON "ComentarioTarefa"("familiaId", "criadoEm");

-- CreateIndex
CREATE INDEX "ComentarioTarefa_autorId_idx" ON "ComentarioTarefa"("autorId");

-- CreateIndex
CREATE INDEX "ComentarioMencao_usuarioId_lidaEm_idx" ON "ComentarioMencao"("usuarioId", "lidaEm");

-- CreateIndex
CREATE UNIQUE INDEX "ComentarioMencao_comentarioId_usuarioId_key" ON "ComentarioMencao"("comentarioId", "usuarioId");

-- CreateIndex
CREATE INDEX "TorreIndicadorDiario_data_idx" ON "TorreIndicadorDiario"("data");

-- CreateIndex
CREATE UNIQUE INDEX "TorreIndicadorDiario_data_key" ON "TorreIndicadorDiario"("data");

-- CreateIndex
CREATE INDEX "RelatorioVisao_dominio_compartilhada_idx" ON "RelatorioVisao"("dominio", "compartilhada");

-- AddForeignKey
ALTER TABLE "IndisponibilidadeOperacional" ADD CONSTRAINT "IndisponibilidadeOperacional_sucessorSugeridoId_fkey" FOREIGN KEY ("sucessorSugeridoId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComentarioTarefa" ADD CONSTRAINT "ComentarioTarefa_tarefaId_fkey" FOREIGN KEY ("tarefaId") REFERENCES "Tarefa"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComentarioTarefa" ADD CONSTRAINT "ComentarioTarefa_familiaId_fkey" FOREIGN KEY ("familiaId") REFERENCES "Familia"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComentarioTarefa" ADD CONSTRAINT "ComentarioTarefa_autorId_fkey" FOREIGN KEY ("autorId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComentarioMencao" ADD CONSTRAINT "ComentarioMencao_comentarioId_fkey" FOREIGN KEY ("comentarioId") REFERENCES "ComentarioTarefa"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComentarioMencao" ADD CONSTRAINT "ComentarioMencao_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

