-- Torre de Controle, Bloco C (29/09/2026): a Tarefa passa a poder apontar
-- diretamente para o OrgaoProtocolo que aguarda (espelha Documento.orgaoId
-- quando há documento; campo próprio quando não há). Nenhum backfill aqui —
-- feito à parte, por script, com a lista de vínculos mostrada antes de
-- aplicar (não é um DEFAULT mecânico: exige casar nome de cartório).
ALTER TABLE "Tarefa" ADD COLUMN "orgaoId" INTEGER;

ALTER TABLE "Tarefa" ADD CONSTRAINT "Tarefa_orgaoId_fkey"
  FOREIGN KEY ("orgaoId") REFERENCES "OrgaoProtocolo"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "Tarefa_orgaoId_idx" ON "Tarefa"("orgaoId");
