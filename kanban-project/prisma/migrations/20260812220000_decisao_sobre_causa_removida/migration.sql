-- A DECISÃO SOBRE A TAREFA QUE PERDEU A CAUSA.
--
-- `causaRemovidaEm` marca o problema; faltava onde guardar a resposta. Sem ela,
-- "manter o trabalho" só poderia ser expresso apagando a marca — e o
-- reconciliador, que decide olhando o workflow encerrado, remarcaria a tarefa na
-- passada seguinte. A fila voltaria a pedir uma decisão já tomada.
--
-- Aditivo e reversível: quatro colunas anuláveis, nenhuma escrita em linha
-- existente.
ALTER TABLE "Tarefa" ADD COLUMN IF NOT EXISTS "causaDecididaEm"     TIMESTAMP(3);
ALTER TABLE "Tarefa" ADD COLUMN IF NOT EXISTS "causaDecisao"        VARCHAR(20);
ALTER TABLE "Tarefa" ADD COLUMN IF NOT EXISTS "causaDecisaoAutorId" INTEGER;
ALTER TABLE "Tarefa" ADD COLUMN IF NOT EXISTS "causaDecisaoMotivo"  VARCHAR(300);
