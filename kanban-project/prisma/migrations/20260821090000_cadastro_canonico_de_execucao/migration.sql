-- CADASTRO CANÔNICO DE EXECUÇÃO — ações, campos, checklists, canais, dependência.
--
-- ADITIVA. Quatro tabelas novas e quatro colunas novas, todas anuláveis. Nada é
-- alterado, nada é removido, e nenhum caminho existente muda de comportamento por
-- efeito desta migration: enquanto as tabelas estiverem vazias e as colunas nulas,
-- o runtime responde exatamente como respondia.
--
-- O que ela torna possível: o administrador cadastrar o que hoje só existe dentro de
-- componentes React (canais de solicitação, resultados de validação, itens de
-- conferência, campos), e declarar dependência entre passos em vez de deduzi-la da
-- ordem da lista.

-- ── DEFINIÇÃO DO PASSO ──────────────────────────────────────────────────────
ALTER TABLE "PhaseInternalWorkflowStep" ADD COLUMN "dependeDe" JSONB;
ALTER TABLE "PhaseInternalWorkflowStep" ADD COLUMN "executorKey" VARCHAR(40);

-- ── COMPETÊNCIA DA FASE ─────────────────────────────────────────────────────
ALTER TABLE "CatalogoFase" ADD COLUMN "efeitosPermitidos" JSONB;

-- ── AÇÕES ───────────────────────────────────────────────────────────────────
CREATE TABLE "StepAction" (
    "id" SERIAL NOT NULL,
    "stepId" INTEGER NOT NULL,
    "key" VARCHAR(60) NOT NULL,
    "label" VARCHAR(160) NOT NULL,
    "descricao" TEXT,
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "effectKey" VARCHAR(60) NOT NULL,
    "requerCampos" JSONB,
    "permissao" VARCHAR(60),
    "condicao" JSONB,
    "metadata" JSONB,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "StepAction_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "StepAction_stepId_key_key" ON "StepAction"("stepId", "key");
CREATE INDEX "StepAction_stepId_idx" ON "StepAction"("stepId");
ALTER TABLE "StepAction" ADD CONSTRAINT "StepAction_stepId_fkey"
    FOREIGN KEY ("stepId") REFERENCES "PhaseInternalWorkflowStep"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── CAMPOS ──────────────────────────────────────────────────────────────────
CREATE TABLE "StepField" (
    "id" SERIAL NOT NULL,
    "stepId" INTEGER NOT NULL,
    "key" VARCHAR(60) NOT NULL,
    "label" VARCHAR(160) NOT NULL,
    "tipo" VARCHAR(20) NOT NULL,
    "obrigatorio" BOOLEAN NOT NULL DEFAULT false,
    "opcoes" JSONB,
    "condicao" JSONB,
    "ajuda" TEXT,
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "StepField_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "StepField_stepId_key_key" ON "StepField"("stepId", "key");
CREATE INDEX "StepField_stepId_idx" ON "StepField"("stepId");
ALTER TABLE "StepField" ADD CONSTRAINT "StepField_stepId_fkey"
    FOREIGN KEY ("stepId") REFERENCES "PhaseInternalWorkflowStep"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── CHECKLIST ───────────────────────────────────────────────────────────────
CREATE TABLE "StepChecklistItem" (
    "id" SERIAL NOT NULL,
    "stepId" INTEGER NOT NULL,
    "key" VARCHAR(60) NOT NULL,
    "label" VARCHAR(200) NOT NULL,
    "descricao" TEXT,
    "obrigatorio" BOOLEAN NOT NULL DEFAULT true,
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "StepChecklistItem_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "StepChecklistItem_stepId_key_key" ON "StepChecklistItem"("stepId", "key");
CREATE INDEX "StepChecklistItem_stepId_idx" ON "StepChecklistItem"("stepId");
ALTER TABLE "StepChecklistItem" ADD CONSTRAINT "StepChecklistItem_stepId_fkey"
    FOREIGN KEY ("stepId") REFERENCES "PhaseInternalWorkflowStep"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── CANAIS ──────────────────────────────────────────────────────────────────
CREATE TABLE "CanalOperacional" (
    "id" SERIAL NOT NULL,
    "key" VARCHAR(40) NOT NULL,
    "label" VARCHAR(120) NOT NULL,
    "descricao" TEXT,
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "protocoloObrigatorio" BOOLEAN NOT NULL DEFAULT false,
    "anexoObrigatorioLabel" VARCHAR(160),
    "rastreioObrigatorio" BOOLEAN NOT NULL DEFAULT false,
    "observacaoObrigatoria" BOOLEAN NOT NULL DEFAULT false,
    "aplicacao" JSONB,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CanalOperacional_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CanalOperacional_key_key" ON "CanalOperacional"("key");

-- ── LINHAGEM DOCUMENTAL ─────────────────────────────────────────────────────
-- Nova via e retificação sobrescreviam o documento existente. Aditivo: o anterior
-- permanece e o novo aponta para ele. A NECESSIDADE não se duplica.
ALTER TABLE "Documento" ADD COLUMN "derivadoDeId" INTEGER;
ALTER TABLE "Documento" ADD COLUMN "derivacaoTipo" VARCHAR(20);
ALTER TABLE "Documento" ADD COLUMN "substituidoEm" TIMESTAMP(3);
CREATE INDEX "Documento_derivadoDeId_idx" ON "Documento"("derivadoDeId");
ALTER TABLE "Documento" ADD CONSTRAINT "Documento_derivadoDeId_fkey"
    FOREIGN KEY ("derivadoDeId") REFERENCES "Documento"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- Um documento não pode ser o próprio pai.
ALTER TABLE "Documento" ADD CONSTRAINT "Documento_linhagem_nao_reflexiva"
    CHECK ("derivadoDeId" IS NULL OR "derivadoDeId" <> "id");
