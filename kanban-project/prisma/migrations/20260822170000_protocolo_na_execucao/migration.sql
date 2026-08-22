-- PROTOCOLO NA EXECUÇÃO: referência, não cópia.
--
-- A execução passava a guardar `numero_protocolo` dentro do payload, ao lado de um
-- `Protocolo` canônico que já era o dono do mesmo fato — com número, data, órgão,
-- responsável, anexos e vínculo com o documento. Duas verdades editáveis para a
-- mesma coisa, divergindo no dia em que alguém corrigisse uma só.
--
-- Isto acrescenta o ponteiro. Nada é apagado: o payload histórico continua onde
-- está, e `SubtaskExecution.protocolo` (a projeção textual) continua sendo escrita
-- enquanto houver leitor dela.
--
-- ON DELETE SET NULL, e não CASCADE: apagar um protocolo não pode apagar a tentativa
-- que o registrou — o que aconteceu continua tendo acontecido.

ALTER TABLE "StepExecution"    ADD COLUMN IF NOT EXISTS "protocoloId" INTEGER;
ALTER TABLE "SubtaskExecution" ADD COLUMN IF NOT EXISTS "protocoloId" INTEGER;

DO $$ BEGIN
  ALTER TABLE "StepExecution"
    ADD CONSTRAINT "StepExecution_protocoloId_fkey"
    FOREIGN KEY ("protocoloId") REFERENCES "Protocolo"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "SubtaskExecution"
    ADD CONSTRAINT "SubtaskExecution_protocoloId_fkey"
    FOREIGN KEY ("protocoloId") REFERENCES "Protocolo"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "StepExecution_protocoloId_idx"    ON "StepExecution"("protocoloId");
CREATE INDEX IF NOT EXISTS "SubtaskExecution_protocoloId_idx" ON "SubtaskExecution"("protocoloId");
