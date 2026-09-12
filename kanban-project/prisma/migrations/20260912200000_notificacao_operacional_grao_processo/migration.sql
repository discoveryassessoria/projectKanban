-- Etapa 4 (Eventos + histórico + notificações) — NotificacaoOperacional passa
-- a suportar DOIS grãos: TAREFA (já existia) e PROCESSO (novo, para "fase
-- concluída"). Mudança mínima e aditiva, decidida com o usuário depois de
-- comparar 3 alternativas — sem tabela nova, sem tocar em nenhuma outra coluna.
--
-- `tarefaId` deixa de ser obrigatório: uma notificação de fase concluída não
-- tem Tarefa nenhuma — forçar uma "fingiria" uma obrigação que não existe
-- (o mesmo erro que "Tarefas e Projetos", doc 16, já evitou para marco
-- gerencial). `processoId` é a segunda âncora, também opcional; a porta
-- canônica (`notificarAcontecimento`) garante em código que uma notificação
-- nunca preenche as duas ao mesmo tempo — não há CHECK constraint aqui de
-- propósito: a única escritora é essa porta.
--
-- Nenhuma linha existente perde o `tarefaId` que já tinha: só a CONSTRAINT
-- NOT NULL sai. Aditivo e seguro para as 14 notificações já em produção.

ALTER TABLE "NotificacaoOperacional" ALTER COLUMN "tarefaId" DROP NOT NULL;

ALTER TABLE "NotificacaoOperacional" ADD COLUMN IF NOT EXISTS "processoId" INTEGER;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'NotificacaoOperacional_processoId_fkey'
  ) THEN
    ALTER TABLE "NotificacaoOperacional"
      ADD CONSTRAINT "NotificacaoOperacional_processoId_fkey"
      FOREIGN KEY ("processoId") REFERENCES "Processo"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "NotificacaoOperacional_processoId_idx" ON "NotificacaoOperacional"("processoId");
