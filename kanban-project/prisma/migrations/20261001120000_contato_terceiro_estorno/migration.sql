-- TORRE NOVA — DESFAZER de "Registrar cobrança": ESTORNO de ContatoTerceiro.
--
-- ContatoTerceiro continua FATO append-only: o estorno NÃO apaga a linha, MARCA-A. Todo leitor que conta
-- "cobranças sem resposta", escalada, última cobrança, tempo de espera ou histórico ignora (ou exibe riscado)
-- o contato com estornadoEm preenchido. Guarda também o estado da execução ANTES da cobrança, para o estorno
-- devolver a "próxima cobrança" e a escalada exatamente como estavam.
--
-- ADITIVA e IDEMPOTENTE (só colunas nullable + FK ON DELETE SET NULL).

ALTER TABLE "ContatoTerceiro" ADD COLUMN IF NOT EXISTS "estornadoEm" TIMESTAMP(3);
ALTER TABLE "ContatoTerceiro" ADD COLUMN IF NOT EXISTS "estornadoPorId" INTEGER;
ALTER TABLE "ContatoTerceiro" ADD COLUMN IF NOT EXISTS "antesProximoAcompanhamentoEm" TIMESTAMP(3);
ALTER TABLE "ContatoTerceiro" ADD COLUMN IF NOT EXISTS "antesEscalada" BOOLEAN;
ALTER TABLE "ContatoTerceiro" ADD COLUMN IF NOT EXISTS "antesEscaladaEm" TIMESTAMP(3);
ALTER TABLE "ContatoTerceiro" ADD COLUMN IF NOT EXISTS "depoisProximoAcompanhamentoEm" TIMESTAMP(3);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ContatoTerceiro_estornadoPorId_fkey') THEN
    ALTER TABLE "ContatoTerceiro" ADD CONSTRAINT "ContatoTerceiro_estornadoPorId_fkey"
      FOREIGN KEY ("estornadoPorId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
