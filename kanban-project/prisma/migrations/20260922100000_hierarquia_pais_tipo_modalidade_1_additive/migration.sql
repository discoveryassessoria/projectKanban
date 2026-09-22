-- MANDATO "Reconstrução da hierarquia País/Tipo/Modalidade/Workflow Macro" (22/09/2026).
-- PASSO 1 de 3 — SÓ ADITIVO. Nenhuma coluna existente é removida, nenhuma
-- tabela é apagada, nenhum registro é tocado. Isto é seguro em qualquer banco,
-- vazio ou com dados reais: colunas novas nascem NULLABLE (ou com DEFAULT
-- seguro) exatamente para que o backfill (passo 2, script TypeScript,
-- idempotente) tenha onde escrever ANTES de qualquer coisa ficar obrigatória
-- ou ser removida (passo 3).

-- CreateTable — habilitação Tipo × Modalidade (N:N real, substitui o antigo
-- FK único TipoProcessoNacionalidade.modalidadeId).
CREATE TABLE "TipoProcessoModalidadeHabilitada" (
    "id" SERIAL NOT NULL,
    "tipoProcessoId" INTEGER NOT NULL,
    "modalidadeId" INTEGER NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TipoProcessoModalidadeHabilitada_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TipoProcessoModalidadeHabilitada_tipoProcessoId_idx" ON "TipoProcessoModalidadeHabilitada"("tipoProcessoId");
CREATE INDEX "TipoProcessoModalidadeHabilitada_modalidadeId_idx" ON "TipoProcessoModalidadeHabilitada"("modalidadeId");
CREATE UNIQUE INDEX "TipoProcessoModalidadeHabilitada_tipoProcessoId_modalidadeI_key" ON "TipoProcessoModalidadeHabilitada"("tipoProcessoId", "modalidadeId");

ALTER TABLE "TipoProcessoModalidadeHabilitada" ADD CONSTRAINT "TipoProcessoModalidadeHabilitada_tipoProcessoId_fkey" FOREIGN KEY ("tipoProcessoId") REFERENCES "TipoProcessoNacionalidade"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TipoProcessoModalidadeHabilitada" ADD CONSTRAINT "TipoProcessoModalidadeHabilitada_modalidadeId_fkey" FOREIGN KEY ("modalidadeId") REFERENCES "ModalidadePais"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AlterTable — MacroWorkflow ganha a dimensão modalidade (NULLABLE por
-- enquanto — o backfill preenche a partir do Tipo antes de qualquer coisa
-- exigir NOT NULL) e a cardinalidade do requerimento (DEFAULT seguro:
-- INDIVIDUAL é o valor mais comum hoje, e o backfill corrige os casos reais
-- de COLETIVO explicitamente).
ALTER TABLE "MacroWorkflow" ADD COLUMN "modalidadeId" INTEGER;
ALTER TABLE "MacroWorkflow" ADD COLUMN "cardinalidadeRequerimento" VARCHAR(20) NOT NULL DEFAULT 'INDIVIDUAL';

CREATE INDEX "MacroWorkflow_modalidadeId_idx" ON "MacroWorkflow"("modalidadeId");
ALTER TABLE "MacroWorkflow" ADD CONSTRAINT "MacroWorkflow_modalidadeId_fkey" FOREIGN KEY ("modalidadeId") REFERENCES "ModalidadePais"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AlterTable — MacroWorkflowVersao congela a mesma dimensão, NULLABLE até o backfill.
ALTER TABLE "MacroWorkflowVersao" ADD COLUMN "modalidadeId" INTEGER;
ALTER TABLE "MacroWorkflowVersao" ADD COLUMN "cardinalidadeRequerimento" VARCHAR(20);

-- AlterTable — Processo ganha a modalidade (NULLABLE até o backfill; passo 3
-- aperta pra NOT NULL depois que os 100% dos processos existentes tiverem
-- sido preenchidos e verificados).
ALTER TABLE "Processo" ADD COLUMN "modalidadeId" INTEGER;
CREATE INDEX "Processo_modalidadeId_idx" ON "Processo"("modalidadeId");
ALTER TABLE "Processo" ADD CONSTRAINT "Processo_modalidadeId_fkey" FOREIGN KEY ("modalidadeId") REFERENCES "ModalidadePais"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- RequisitoCadastral.modalidadeLegalId: já comprovadamente vazio em produção
-- (0 linhas na tabela inteira) — seguro remover agora, sem backfill.
ALTER TABLE "RequisitoCadastral" DROP CONSTRAINT "RequisitoCadastral_modalidadeLegalId_fkey";
DROP INDEX "RequisitoCadastral_modalidadeLegalId_idx";
ALTER TABLE "RequisitoCadastral" DROP COLUMN "modalidadeLegalId";
