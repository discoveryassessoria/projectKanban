-- MOTOR OPERACIONAL UNIVERSAL — dependências, política de SLA e causa removida.
--
-- Aditivo em tudo: nenhuma coluna sai, nenhum dado é reescrito.

-- ── ESPERA EXTERNA E O RELÓGIO DO SLA ──────────────────────────────────────
-- Nem toda espera pausa o prazo. Um cartório que demora 40 dias não pode
-- consumir um SLA de 5; uma espera por resposta do cliente frequentemente DEVE
-- contar. Quem decide é o workflow publicado — estas colunas só guardam o que
-- já aconteceu.
ALTER TABLE "Tarefa"
  ADD COLUMN IF NOT EXISTS "slaPausadoEm"         TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "slaPausaAcumuladaMin" INTEGER NOT NULL DEFAULT 0,
  -- A obrigação sumiu DEPOIS que alguém já trabalhou. Cancelar sozinho jogaria
  -- fora esforço real; ignorar deixaria a fila mentindo. Fica marcado e espera
  -- decisão de quem pode tomá-la.
  ADD COLUMN IF NOT EXISTS "causaRemovidaEm"      TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "causaRemovidaMotivo"  VARCHAR(300);

ALTER TABLE "PhaseInternalWorkflow"
  ADD COLUMN IF NOT EXISTS "pausarSlaEmEsperaExterna" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "pausarSlaEmBloqueio"      BOOLEAN NOT NULL DEFAULT false;

-- ── DEPENDÊNCIA ENTRE TAREFAS ──────────────────────────────────────────────
-- "Traduzir a certidão" depende de "obter a certidão", e são DOIS trabalhos:
-- responsáveis diferentes, prazos diferentes, equipes possivelmente diferentes.
-- Modelar a segunda como etapa da primeira faria a tradução herdar o dono da
-- emissão e sumir da fila de quem traduz.
CREATE TABLE IF NOT EXISTS "TarefaDependencia" (
  "id"          SERIAL PRIMARY KEY,
  "tarefaId"    INTEGER NOT NULL,
  "dependeDeId" INTEGER NOT NULL,
  "obrigatoria" BOOLEAN NOT NULL DEFAULT true,
  "motivo"      VARCHAR(200),
  "criadoEm"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

DO $$ BEGIN
  ALTER TABLE "TarefaDependencia"
    ADD CONSTRAINT "TarefaDependencia_tarefaId_fkey"    FOREIGN KEY ("tarefaId")    REFERENCES "Tarefa"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT "TarefaDependencia_dependeDeId_fkey" FOREIGN KEY ("dependeDeId") REFERENCES "Tarefa"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Um par só existe uma vez: reconciliar N vezes não empilha dependências.
CREATE UNIQUE INDEX IF NOT EXISTS "TarefaDependencia_tarefaId_dependeDeId_key"
  ON "TarefaDependencia"("tarefaId", "dependeDeId");
CREATE INDEX IF NOT EXISTS "TarefaDependencia_dependeDeId_idx"
  ON "TarefaDependencia"("dependeDeId");
