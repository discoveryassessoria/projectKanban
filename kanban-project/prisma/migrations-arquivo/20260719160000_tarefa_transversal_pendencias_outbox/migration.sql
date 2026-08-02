-- Aditivo, não-destrutivo. Preserva dados/vínculos existentes.

-- TipoTarefa (NORMAL default → tarefas atuais permanecem NORMAL)
CREATE TYPE "TipoTarefa" AS ENUM ('NORMAL', 'TRANSVERSAL');

-- Tarefa Transversal: campos aditivos (refs "soltas", sem FK, padrão executedById)
ALTER TABLE "Tarefa" ADD COLUMN "tipo" "TipoTarefa" NOT NULL DEFAULT 'NORMAL';
ALTER TABLE "Tarefa" ADD COLUMN "faseOrigemCode" VARCHAR(60);
ALTER TABLE "Tarefa" ADD COLUMN "faseReferenciaCode" VARCHAR(60);
ALTER TABLE "Tarefa" ADD COLUMN "workflowInstanceOrigemId" INTEGER;
ALTER TABLE "Tarefa" ADD COLUMN "pessoaId" INTEGER;
ALTER TABLE "Tarefa" ADD COLUMN "tipoDocumentoId" INTEGER;
ALTER TABLE "Tarefa" ADD COLUMN "acaoStepKey" VARCHAR(80);
ALTER TABLE "Tarefa" ADD COLUMN "motivo" TEXT;
ALTER TABLE "Tarefa" ADD COLUMN "resultadoEsperado" TEXT;
ALTER TABLE "Tarefa" ADD COLUMN "resultadoObtido" TEXT;
ALTER TABLE "Tarefa" ADD COLUMN "createdBy" INTEGER;
CREATE INDEX "Tarefa_tipo_idx" ON "Tarefa"("tipo");
CREATE INDEX "Tarefa_pessoaId_idx" ON "Tarefa"("pessoaId");

-- PendenciaFinanceira: reprocessamento
ALTER TABLE "PendenciaFinanceira" ADD COLUMN "tentativas" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "PendenciaFinanceira" ADD COLUMN "ultimaTentativaEm" TIMESTAMP(3);
ALTER TABLE "PendenciaFinanceira" ADD COLUMN "ultimaFalha" VARCHAR(500);

-- DomainOutbox: claim atômico
ALTER TABLE "DomainOutbox" ADD COLUMN "reservadoEm" TIMESTAMP(3);
