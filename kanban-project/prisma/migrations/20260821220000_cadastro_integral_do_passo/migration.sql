-- CADASTRO INTEGRAL DO PASSO — opções, canais por passo, requisitos e rascunho.
--
-- ADITIVA. Três tabelas novas e duas colunas anuláveis. Enquanto as tabelas estiverem
-- vazias e as colunas nulas, o runtime responde exatamente como responde hoje: as
-- opções continuam vindo do JSON do campo, os canais do catálogo global, e salvar
-- continua publicando. O que muda é passar a existir onde configurar cada uma dessas
-- coisas sem tocar em código.
--
-- O QUE CADA UMA RESOLVE
--   StepFieldOption  — opção com identidade: dá para INATIVAR sem apagar, e o
--                      histórico continua sabendo o que a opção era. JSON não tem
--                      onde guardar isso.
--   StepChannel      — quais canais ESTE passo oferece e o que cada um exige AQUI.
--                      Antes: "todos os ativos do catálogo", e o requisito por canal
--                      só existia dentro do executor.
--   StepRequirement  — a AFIRMAÇÃO sobre campo/checklist/evidência ("precisa estar
--                      preenchido"). Campo é coisa; requisito é condição.

-- ── OPÇÕES DE CAMPO ─────────────────────────────────────────────────────────
CREATE TABLE "StepFieldOption" (
    "id" SERIAL NOT NULL,
    "fieldId" INTEGER NOT NULL,
    "key" VARCHAR(60) NOT NULL,
    "label" VARCHAR(200) NOT NULL,
    "descricao" TEXT,
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "condicao" JSONB,
    "metadata" JSONB,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "StepFieldOption_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "StepFieldOption_fieldId_key_key" ON "StepFieldOption"("fieldId", "key");
CREATE INDEX "StepFieldOption_fieldId_idx" ON "StepFieldOption"("fieldId");
ALTER TABLE "StepFieldOption" ADD CONSTRAINT "StepFieldOption_fieldId_fkey"
    FOREIGN KEY ("fieldId") REFERENCES "StepField"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StepFieldOption" ADD CONSTRAINT "StepFieldOption_key_nao_vazia"
    CHECK (length(btrim("key")) > 0);

-- ── CANAIS DO PASSO ─────────────────────────────────────────────────────────
CREATE TABLE "StepChannel" (
    "id" SERIAL NOT NULL,
    "stepId" INTEGER NOT NULL,
    "canalId" INTEGER NOT NULL,
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "exigeProtocolo" BOOLEAN,
    "exigeAnexo" BOOLEAN,
    "exigeRastreio" BOOLEAN,
    "exigeObservacao" BOOLEAN,
    "camposObrigatorios" JSONB,
    "condicao" JSONB,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "StepChannel_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "StepChannel_stepId_canalId_key" ON "StepChannel"("stepId", "canalId");
CREATE INDEX "StepChannel_stepId_idx" ON "StepChannel"("stepId");
CREATE INDEX "StepChannel_canalId_idx" ON "StepChannel"("canalId");
ALTER TABLE "StepChannel" ADD CONSTRAINT "StepChannel_stepId_fkey"
    FOREIGN KEY ("stepId") REFERENCES "PhaseInternalWorkflowStep"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StepChannel" ADD CONSTRAINT "StepChannel_canalId_fkey"
    FOREIGN KEY ("canalId") REFERENCES "CanalOperacional"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── REQUISITOS ──────────────────────────────────────────────────────────────
CREATE TABLE "StepRequirement" (
    "id" SERIAL NOT NULL,
    "stepId" INTEGER NOT NULL,
    "key" VARCHAR(60) NOT NULL,
    "label" VARCHAR(200) NOT NULL,
    "descricao" TEXT,
    "tipo" VARCHAR(30) NOT NULL,
    "alvoKey" VARCHAR(60),
    "minimo" INTEGER NOT NULL DEFAULT 1,
    "obrigatorio" BOOLEAN NOT NULL DEFAULT true,
    "condicao" JSONB,
    "acaoKey" VARCHAR(60),
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "StepRequirement_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "StepRequirement_stepId_key_key" ON "StepRequirement"("stepId", "key");
CREATE INDEX "StepRequirement_stepId_idx" ON "StepRequirement"("stepId");
ALTER TABLE "StepRequirement" ADD CONSTRAINT "StepRequirement_stepId_fkey"
    FOREIGN KEY ("stepId") REFERENCES "PhaseInternalWorkflowStep"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- O tipo é vocabulário fechado: um valor fora dele seria um requisito que o motor não
-- sabe avaliar, e que passaria despercebido como "sempre cumprido".
ALTER TABLE "StepRequirement" ADD CONSTRAINT "StepRequirement_tipo_conhecido"
    CHECK ("tipo" IN ('CAMPO_PREENCHIDO', 'CHECKLIST_COMPLETO', 'EVIDENCIA_ANEXADA', 'ACAO_EXECUTADA'));

-- ── RASCUNHO ────────────────────────────────────────────────────────────────
-- A definição viva sempre foi o rascunho e a versão congelada sempre foi o publicado.
-- Faltava separar "guardei" de "publiquei" — sem isso não havia como olhar o diff
-- antes de decidir.
ALTER TABLE "PhaseInternalWorkflow" ADD COLUMN "rascunhoAlteradoEm" TIMESTAMP(3);
ALTER TABLE "PhaseInternalWorkflow" ADD COLUMN "rascunhoAlteradoPor" INTEGER;
