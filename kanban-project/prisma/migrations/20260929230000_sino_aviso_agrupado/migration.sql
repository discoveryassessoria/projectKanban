-- Redesenho do sino (29/09/2026): UM aviso por (pessoa, família, tipo), atualizado no
-- lugar, em vez de um aviso por tarefa. Migration ADITIVA: colunas novas com default,
-- nenhuma linha existente é alterada de significado (`agrupado = false` = modelo antigo;
-- a conversão/limpeza dos dados atuais é um script à parte, com ensaio e backup).
ALTER TABLE "NotificacaoOperacional"
    ADD COLUMN "agrupado"     BOOLEAN       NOT NULL DEFAULT false,
    ADD COLUMN "contagem"     INTEGER       NOT NULL DEFAULT 1,
    ADD COLUMN "tarefaIds"    INTEGER[]     NOT NULL DEFAULT ARRAY[]::INTEGER[],
    ADD COLUMN "resumo"       JSONB,
    ADD COLUMN "atualizadoEm" TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Linhas antigas: a "última atualização" é a criação, não o instante da migration.
UPDATE "NotificacaoOperacional" SET "atualizadoEm" = "criadoEm";

CREATE INDEX "NotificacaoOperacional_sino_idx"
    ON "NotificacaoOperacional"("destinatarioId", "agrupado", "lidaEm", "atualizadoEm");

-- A trava física: no máximo UM aviso agrupado NÃO LIDO por (destinatário, família, tipo).
-- `COALESCE(processoId, 0)` porque avisos sem família (ex.: INTEGRIDADE do sistema) também
-- não podem empilhar. Só linhas `agrupado` — as antigas (FASE_CONCLUIDA por admin/processo
-- etc.) não competem por esta trava.
CREATE UNIQUE INDEX "NotificacaoOperacional_um_aberto_por_familia_tipo"
    ON "NotificacaoOperacional"("destinatarioId", COALESCE("processoId", 0), "tipo")
    WHERE "agrupado" = true AND "lidaEm" IS NULL;
