-- SUBTAREFA CANÔNICA — o que acontece DENTRO de um passo vira definição versionada.
--
-- ADITIVA. Duas tabelas novas de definição, uma de execução, uma de vínculo, e colunas
-- anuláveis nas tabelas existentes. Enquanto não houver subtarefa cadastrada, o motor
-- responde exatamente como responde hoje: o passo continua sendo concluído pela ação
-- do passo (`regraDeConclusao = ACAO_DO_PASSO`, que é o padrão), os filhos continuam
-- pertencendo ao passo (`subtaskId IS NULL`) e nenhuma execução de subtarefa existe.
--
-- O QUE CADA UMA RESOLVE
--   StepSubtaskDefinition — "solicitar via fornecedor", "registrar protocolo",
--                           "aguardar retorno" eram trechos de um componente React.
--                           Não tinham identidade, estado, execução nem histórico.
--   SubtaskExecution      — quem executou a subtarefa, quando, com que resultado, em
--                           qual tentativa. Append-only, como a tentativa do passo.
--   OrganizacaoCanal      — "por onde dá para pedir" é fato do CARTÓRIO, não decisão
--                           do workflow. O passo passa a REFERENCIAR os canais do
--                           fornecedor concreto em vez de listar todos os do catálogo.
--   subtaskId nos filhos  — campo, ação, checklist e requisito passam a poder
--                           pertencer a uma subtarefa em vez de ao passo inteiro.

-- ── DEFINIÇÃO DA SUBTAREFA ──────────────────────────────────────────────────
CREATE TABLE "StepSubtaskDefinition" (
    "id" SERIAL NOT NULL,
    "stepId" INTEGER NOT NULL,
    "key" VARCHAR(60) NOT NULL,
    "label" VARCHAR(200) NOT NULL,
    "descricao" TEXT,
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "obrigatoria" BOOLEAN NOT NULL DEFAULT true,
    "repetivel" BOOLEAN NOT NULL DEFAULT false,
    "maxOcorrencias" INTEGER,
    "modoExecucao" VARCHAR(20) NOT NULL DEFAULT 'MANUAL',
    "responsavelRegra" VARCHAR(20) NOT NULL DEFAULT 'HERDA',
    "responsavelId" INTEGER,
    "slaDays" INTEGER,
    "condicaoEntrada" JSONB,
    "condicaoConclusao" JSONB,
    "condicaoVisibilidade" JSONB,
    "dependeDe" JSONB,
    "executorKey" VARCHAR(40),
    "cardinalidade" VARCHAR(20),
    "fonteDeCanais" VARCHAR(30) NOT NULL DEFAULT 'NENHUMA',
    "tiposDeCanal" JSONB,
    "reaberturaPermitida" BOOLEAN,
    "reaberturaExigeJustificativa" BOOLEAN,
    "reaberturaPermissao" VARCHAR(60),
    "metadata" JSONB,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "StepSubtaskDefinition_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "StepSubtaskDefinition_stepId_key_key" ON "StepSubtaskDefinition"("stepId", "key");
CREATE INDEX "StepSubtaskDefinition_stepId_idx" ON "StepSubtaskDefinition"("stepId");
ALTER TABLE "StepSubtaskDefinition" ADD CONSTRAINT "StepSubtaskDefinition_stepId_fkey"
    FOREIGN KEY ("stepId") REFERENCES "PhaseInternalWorkflowStep"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StepSubtaskDefinition" ADD CONSTRAINT "StepSubtaskDefinition_key_nao_vazia"
    CHECK (length(btrim("key")) > 0);
-- Vocabulários fechados: um valor fora deles seria configuração que o motor não sabe
-- interpretar, e que passaria despercebida como "comportamento padrão".
ALTER TABLE "StepSubtaskDefinition" ADD CONSTRAINT "StepSubtaskDefinition_modo_conhecido"
    CHECK ("modoExecucao" IN ('MANUAL', 'AUTOMATICA'));
ALTER TABLE "StepSubtaskDefinition" ADD CONSTRAINT "StepSubtaskDefinition_responsavel_conhecido"
    CHECK ("responsavelRegra" IN ('HERDA', 'ESPECIFICO', 'REGRA'));
ALTER TABLE "StepSubtaskDefinition" ADD CONSTRAINT "StepSubtaskDefinition_fonte_canais_conhecida"
    CHECK ("fonteDeCanais" IN ('NENHUMA', 'FORNECEDOR_RELACIONADO', 'TIPOS_PERMITIDOS'));
-- Teto de ocorrências só existe para quem repete, e teto tem de ser ao menos 1.
ALTER TABLE "StepSubtaskDefinition" ADD CONSTRAINT "StepSubtaskDefinition_ocorrencias_coerentes"
    CHECK ("maxOcorrencias" IS NULL OR ("repetivel" = true AND "maxOcorrencias" >= 1));

-- ── REGRA DE CONCLUSÃO DO PASSO ─────────────────────────────────────────────
-- `completionRule` continua sendo o texto livre herdado, exibido e nunca interpretado.
-- Esta é a coluna que o motor lê. O default reproduz o que sempre valeu.
ALTER TABLE "PhaseInternalWorkflowStep" ADD COLUMN "regraDeConclusao" VARCHAR(40) NOT NULL DEFAULT 'ACAO_DO_PASSO';
ALTER TABLE "PhaseInternalWorkflowStep" ADD CONSTRAINT "PhaseInternalWorkflowStep_regra_conclusao_conhecida"
    CHECK ("regraDeConclusao" IN ('ACAO_DO_PASSO', 'TODAS_SUBTAREFAS_OBRIGATORIAS', 'QUALQUER_SUBTAREFA'));

-- ── OS FILHOS PASSAM A PODER SER DA SUBTAREFA ───────────────────────────────
-- NULL = do passo, que é como tudo o que já existe continua.
ALTER TABLE "StepAction" ADD COLUMN "subtaskId" INTEGER;
ALTER TABLE "StepField" ADD COLUMN "subtaskId" INTEGER;
ALTER TABLE "StepChecklistItem" ADD COLUMN "subtaskId" INTEGER;
ALTER TABLE "StepRequirement" ADD COLUMN "subtaskId" INTEGER;
ALTER TABLE "StepAction" ADD CONSTRAINT "StepAction_subtaskId_fkey"
    FOREIGN KEY ("subtaskId") REFERENCES "StepSubtaskDefinition"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StepField" ADD CONSTRAINT "StepField_subtaskId_fkey"
    FOREIGN KEY ("subtaskId") REFERENCES "StepSubtaskDefinition"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StepChecklistItem" ADD CONSTRAINT "StepChecklistItem_subtaskId_fkey"
    FOREIGN KEY ("subtaskId") REFERENCES "StepSubtaskDefinition"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StepRequirement" ADD CONSTRAINT "StepRequirement_subtaskId_fkey"
    FOREIGN KEY ("subtaskId") REFERENCES "StepSubtaskDefinition"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "StepAction_subtaskId_idx" ON "StepAction"("subtaskId");
CREATE INDEX "StepField_subtaskId_idx" ON "StepField"("subtaskId");
CREATE INDEX "StepChecklistItem_subtaskId_idx" ON "StepChecklistItem"("subtaskId");
CREATE INDEX "StepRequirement_subtaskId_idx" ON "StepRequirement"("subtaskId");

-- ── REQUISITO DE EVIDÊNCIA ──────────────────────────────────────────────────
-- "Precisa haver comprovante anexado" É um requisito. Separá-lo numa tabela própria
-- criaria duas respostas para "o que falta para concluir".
ALTER TABLE "StepRequirement" ADD COLUMN "evidenciaTipoId" INTEGER;
ALTER TABLE "StepRequirement" ADD COLUMN "mimesPermitidos" JSONB;
ALTER TABLE "StepRequirement" ADD COLUMN "momento" VARCHAR(24) NOT NULL DEFAULT 'AO_CONCLUIR';
ALTER TABLE "StepRequirement" ADD CONSTRAINT "StepRequirement_evidenciaTipoId_fkey"
    FOREIGN KEY ("evidenciaTipoId") REFERENCES "TipoDocumentoCadastro"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "StepRequirement" ADD CONSTRAINT "StepRequirement_momento_conhecido"
    CHECK ("momento" IN ('AO_CONCLUIR', 'AO_EXECUTAR_ACAO', 'SEMPRE'));
-- Requisito com tipo CHECKLIST_COMPLETO/EVIDENCIA_ANEXADA já existia; o tipo continua
-- protegido pelo CHECK criado em 20260821220000.

-- ── EXECUÇÃO DA SUBTAREFA ───────────────────────────────────────────────────
CREATE TABLE "SubtaskExecution" (
    "id" SERIAL NOT NULL,
    "stepInstanceId" INTEGER NOT NULL,
    "subtaskKey" VARCHAR(60) NOT NULL,
    "subtaskDefinitionId" INTEGER,
    "workflowVersao" INTEGER,
    "sequencia" INTEGER NOT NULL,
    "status" VARCHAR(24) NOT NULL,
    "motivo" VARCHAR(30) NOT NULL,
    "bloqueioCodigo" VARCHAR(40),
    "bloqueioAlvo" VARCHAR(120),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "executadoPorId" INTEGER,
    "responsavelId" INTEGER,
    "prazo" TIMESTAMP(3),
    "resultado" VARCHAR(60),
    "payload" JSONB,
    "fornecedorId" INTEGER,
    "canalKey" VARCHAR(40),
    "protocolo" VARCHAR(120),
    "enviadoEm" TIMESTAMP(3),
    "previstoPara" TIMESTAMP(3),
    "supersededAt" TIMESTAMP(3),
    "supersededPorId" INTEGER,
    "correlationId" VARCHAR(60),
    "chaveIdempotencia" VARCHAR(200) NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SubtaskExecution_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SubtaskExecution_chaveIdempotencia_key" ON "SubtaskExecution"("chaveIdempotencia");
CREATE UNIQUE INDEX "SubtaskExecution_stepInstanceId_subtaskKey_sequencia_key"
    ON "SubtaskExecution"("stepInstanceId", "subtaskKey", "sequencia");
CREATE INDEX "SubtaskExecution_stepInstanceId_idx" ON "SubtaskExecution"("stepInstanceId");
CREATE INDEX "SubtaskExecution_subtaskKey_idx" ON "SubtaskExecution"("subtaskKey");
ALTER TABLE "SubtaskExecution" ADD CONSTRAINT "SubtaskExecution_stepInstanceId_fkey"
    FOREIGN KEY ("stepInstanceId") REFERENCES "PhaseWorkflowStepInstance"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SubtaskExecution" ADD CONSTRAINT "SubtaskExecution_fornecedorId_fkey"
    FOREIGN KEY ("fornecedorId") REFERENCES "OrgaoProtocolo"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- UMA VIGENTE POR SUBTAREFA. Índice PARCIAL, não convenção de código: a execução
-- atual é a que não foi substituída, e duas delas fariam "qual é a atual?" depender
-- de qual linha for lida primeiro.
CREATE UNIQUE INDEX "SubtaskExecution_uma_vigente_por_subtarefa"
    ON "SubtaskExecution"("stepInstanceId", "subtaskKey") WHERE "supersededAt" IS NULL;

-- ESTADO IMPOSSÍVEL NÃO É REPRESENTÁVEL.
ALTER TABLE "SubtaskExecution" ADD CONSTRAINT "SubtaskExecution_status_conhecido"
    CHECK ("status" IN ('PENDENTE','DISPONIVEL','EM_ANDAMENTO','AGUARDANDO_EXTERNO','BLOQUEADO','CONCLUIDO','CANCELADO','INVALIDADO','FALHOU'));
-- Concluída TEM momento de conclusão. Foi este mesmo buraco que o Gate 2 fechou um
-- nível acima: estado de conclusão sem a conclusão.
ALTER TABLE "SubtaskExecution" ADD CONSTRAINT "SubtaskExecution_concluida_tem_data"
    CHECK ("status" <> 'CONCLUIDO' OR "completedAt" IS NOT NULL);
-- Substituída tem DATA, e o ponteiro para a sucessora — quando existir — aponta para
-- OUTRA linha. O ponteiro pode ser nulo por um instante: abrir a sucessora exige tirar
-- a anterior de cena ANTES, senão o índice parcial acima recusa a inserção. "Saiu de
-- cena, e já se sabe quando" é estado legítimo; "aponta para si mesma" nunca seria.
-- É a mesma regra que StepExecution já tinha.
ALTER TABLE "SubtaskExecution" ADD CONSTRAINT "SubtaskExecution_substituicao_coerente"
    CHECK (("supersededAt" IS NULL AND "supersededPorId" IS NULL) OR ("supersededAt" IS NOT NULL AND "supersededPorId" IS DISTINCT FROM "id"));
-- Bloqueio TEM causa: "bloqueada" sem dizer por quê é o que a UI não consegue explicar.
ALTER TABLE "SubtaskExecution" ADD CONSTRAINT "SubtaskExecution_bloqueio_tem_causa"
    CHECK ("status" <> 'BLOQUEADO' OR "bloqueioCodigo" IS NOT NULL);

-- ── OS CANAIS PERTENCEM A QUEM ATENDE ───────────────────────────────────────
CREATE TABLE "OrganizacaoCanal" (
    "id" SERIAL NOT NULL,
    "organizacaoId" INTEGER NOT NULL,
    "canalId" INTEGER NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "exigeProtocolo" BOOLEAN,
    "exigeAnexo" BOOLEAN,
    "exigeRastreio" BOOLEAN,
    "exigeObservacao" BOOLEAN,
    "endereco" VARCHAR(300),
    "prazoDias" INTEGER,
    "observacao" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "OrganizacaoCanal_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "OrganizacaoCanal_organizacaoId_canalId_key" ON "OrganizacaoCanal"("organizacaoId", "canalId");
CREATE INDEX "OrganizacaoCanal_organizacaoId_idx" ON "OrganizacaoCanal"("organizacaoId");
CREATE INDEX "OrganizacaoCanal_canalId_idx" ON "OrganizacaoCanal"("canalId");
ALTER TABLE "OrganizacaoCanal" ADD CONSTRAINT "OrganizacaoCanal_organizacaoId_fkey"
    FOREIGN KEY ("organizacaoId") REFERENCES "OrgaoProtocolo"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OrganizacaoCanal" ADD CONSTRAINT "OrganizacaoCanal_canalId_fkey"
    FOREIGN KEY ("canalId") REFERENCES "CanalOperacional"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── O DOCUMENTO PASSA A DECLARAR SEU ÓRGÃO ──────────────────────────────────
-- `cartorio` sempre foi texto livre: o que o operador digitou. Nome não tem canal,
-- não tem endereço e não tem cadastro — não dá para perguntar a um nome por onde ele
-- atende. Sem este vínculo, "use os canais do fornecedor relacionado" não teria a quem
-- se referir, e a subtarefa cairia de volta na lista global que este trabalho desfaz.
-- Anulável: documento sem órgão identificado continua existindo, e a subtarefa que
-- depende de canal fica bloqueada dizendo exatamente isso.
ALTER TABLE "Documento" ADD COLUMN "orgaoId" INTEGER;
ALTER TABLE "Documento" ADD CONSTRAINT "Documento_orgaoId_fkey"
    FOREIGN KEY ("orgaoId") REFERENCES "OrgaoProtocolo"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "Documento_orgaoId_idx" ON "Documento"("orgaoId");
