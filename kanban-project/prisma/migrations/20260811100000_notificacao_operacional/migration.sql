-- NOTIFICAÇÃO OPERACIONAL — marco da TAREFA, nunca da etapa.
--
-- O sino de hoje é derivado por consulta: ele olha `Tarefa.dataPrazo` e
-- classifica em vencidas/hoje/próximos. Isso resolve prazo e não resolve
-- ATRIBUIÇÃO: "você recebeu esta tarefa" é um fato que acontece num instante e
-- precisa sobreviver a ele — não há de onde derivar "avisei" nem "já viu".
--
-- `chaveIdempotencia` é o que impede o retry de virar dois avisos, e impede o
-- aviso de prazo de renascer a cada varredura (a chave carrega o DIA). Sino que
-- repete deixa de ser lido.
CREATE TABLE IF NOT EXISTS "NotificacaoOperacional" (
  "id"                SERIAL PRIMARY KEY,
  "tipo"              VARCHAR(24) NOT NULL,
  "destinatarioId"    INTEGER NOT NULL,
  "tarefaId"          INTEGER NOT NULL,
  "titulo"            VARCHAR(200) NOT NULL,
  "mensagem"          TEXT,
  "link"              VARCHAR(300),
  "autorId"           INTEGER,
  "chaveIdempotencia" VARCHAR(220) NOT NULL,
  "lidaEm"            TIMESTAMP(3),
  "criadoEm"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

DO $$ BEGIN
  ALTER TABLE "NotificacaoOperacional"
    ADD CONSTRAINT "NotificacaoOperacional_destinatarioId_fkey" FOREIGN KEY ("destinatarioId") REFERENCES "Usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    -- Tarefa apagada não deixa aviso apontando para o vazio.
    ADD CONSTRAINT "NotificacaoOperacional_tarefaId_fkey" FOREIGN KEY ("tarefaId") REFERENCES "Tarefa"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "NotificacaoOperacional_chaveIdempotencia_key"
  ON "NotificacaoOperacional"("chaveIdempotencia");
CREATE INDEX IF NOT EXISTS "NotificacaoOperacional_destinatarioId_lidaEm_idx"
  ON "NotificacaoOperacional"("destinatarioId", "lidaEm");
CREATE INDEX IF NOT EXISTS "NotificacaoOperacional_tarefaId_idx"
  ON "NotificacaoOperacional"("tarefaId");
