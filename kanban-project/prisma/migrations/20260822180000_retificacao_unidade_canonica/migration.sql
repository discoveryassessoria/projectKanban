-- A RETIFICAÇÃO PASSA A TER UNIDADE DE TRABALHO COM VÍNCULO REAL.
--
-- ─── O QUE ESTAVA ERRADO ────────────────────────────────────────────────────
-- `RetificacaoPacote` já nomeava a coisa certa — um pedido de retificação, com tipo
-- judicial ou administrativo, status próprio e um conjunto de divergências. Mas os
-- vínculos eram texto e JSON: `cartorio` em vez do órgão, `protocolo` em vez do
-- protocolo, `divergenceIds` como snapshot. Nenhuma pergunta que importa tinha
-- resposta no banco: quais pacotes tratam esta divergência? esta divergência já está
-- num pedido aberto? qual órgão recebeu?
--
-- E a fase da Retificação materializava por PROCESSO: dois pedidos no mesmo processo
-- compartilhavam UMA cadeia de seis passos. Reabrir um reabriria o outro; concluir um
-- concluiria o outro. Não é uma limitação de tela — é a unidade de trabalho errada.
--
-- ─── O QUE ESTE PASSO FAZ ───────────────────────────────────────────────────
-- Acrescenta os vínculos e a âncora. NADA é apagado: `cartorio`, `protocolo`,
-- `dataProtocolo` e `divergenceIds` continuam onde estão, com o que já tiverem.
--
-- A âncora em `PhaseWorkflowStepInstance` é a quarta possível, ao lado de pessoa,
-- necessidade e documento — e pelo mesmo motivo das outras três.
--
-- NÃO troca o escopo da fase. Enquanto ninguém decidir a regra de agrupamento das
-- divergências, a Retificação continua materializando por PROCESSO; a capacidade
-- fica pronta e desligada, que é melhor do que ligada e adivinhando.

ALTER TABLE "RetificacaoPacote" ADD COLUMN IF NOT EXISTS "orgaoId"     INTEGER;
ALTER TABLE "RetificacaoPacote" ADD COLUMN IF NOT EXISTS "protocoloId" INTEGER;

DO $$ BEGIN
  ALTER TABLE "RetificacaoPacote" ADD CONSTRAINT "RetificacaoPacote_orgaoId_fkey"
    FOREIGN KEY ("orgaoId") REFERENCES "OrgaoProtocolo"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "RetificacaoPacote" ADD CONSTRAINT "RetificacaoPacote_protocoloId_fkey"
    FOREIGN KEY ("protocoloId") REFERENCES "Protocolo"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "RetificacaoPacote_orgaoId_idx"     ON "RetificacaoPacote"("orgaoId");
CREATE INDEX IF NOT EXISTS "RetificacaoPacote_protocoloId_idx" ON "RetificacaoPacote"("protocoloId");

-- O NÚMERO DO PACOTE identifica o pedido DENTRO do processo. Sem esta trava, dois
-- "PR-001" no mesmo processo seriam dois pedidos com o mesmo nome.
CREATE UNIQUE INDEX IF NOT EXISTS "RetificacaoPacote_processoId_num_key"
  ON "RetificacaoPacote"("processoId", "num");

-- A DIVERGÊNCIA DENTRO DO PACOTE, por vínculo real.
CREATE TABLE IF NOT EXISTS "RetificacaoPacoteDivergencia" (
  "id"            SERIAL       PRIMARY KEY,
  "pacoteId"      INTEGER      NOT NULL,
  "divergenciaId" INTEGER      NOT NULL,
  "criadoEm"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

DO $$ BEGIN
  ALTER TABLE "RetificacaoPacoteDivergencia" ADD CONSTRAINT "RetificacaoPacoteDivergencia_pacoteId_fkey"
    FOREIGN KEY ("pacoteId") REFERENCES "RetificacaoPacote"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "RetificacaoPacoteDivergencia" ADD CONSTRAINT "RetificacaoPacoteDivergencia_divergenciaId_fkey"
    FOREIGN KEY ("divergenciaId") REFERENCES "Divergencia"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "RetificacaoPacoteDivergencia_pacoteId_divergenciaId_key"
  ON "RetificacaoPacoteDivergencia"("pacoteId", "divergenciaId");
CREATE INDEX IF NOT EXISTS "RetificacaoPacoteDivergencia_divergenciaId_idx"
  ON "RetificacaoPacoteDivergencia"("divergenciaId");

-- A ÂNCORA: a unidade de trabalho da instância de passo.
ALTER TABLE "PhaseWorkflowStepInstance" ADD COLUMN IF NOT EXISTS "retificacaoPacoteId" INTEGER;

DO $$ BEGIN
  ALTER TABLE "PhaseWorkflowStepInstance" ADD CONSTRAINT "PhaseWorkflowStepInstance_retificacaoPacoteId_fkey"
    FOREIGN KEY ("retificacaoPacoteId") REFERENCES "RetificacaoPacote"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "PhaseWorkflowStepInstance_retificacaoPacoteId_idx"
  ON "PhaseWorkflowStepInstance"("retificacaoPacoteId");
