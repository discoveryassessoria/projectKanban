-- Rollout do código público (publicCode) — aditivo/nullable p/ backfill seguro, único.

ALTER TABLE "ServicoProduto" ADD COLUMN "publicCode" VARCHAR(20);
CREATE UNIQUE INDEX "ServicoProduto_publicCode_key" ON "ServicoProduto"("publicCode");
ALTER TABLE "Documento" ADD COLUMN "publicCode" VARCHAR(20);
CREATE UNIQUE INDEX "Documento_publicCode_key" ON "Documento"("publicCode");
ALTER TABLE "Pessoa" ADD COLUMN "publicCode" VARCHAR(20);
CREATE UNIQUE INDEX "Pessoa_publicCode_key" ON "Pessoa"("publicCode");
ALTER TABLE "Fornecedor" ADD COLUMN "publicCode" VARCHAR(20);
CREATE UNIQUE INDEX "Fornecedor_publicCode_key" ON "Fornecedor"("publicCode");
ALTER TABLE "ProdutoFinanceiro" ADD COLUMN "publicCode" VARCHAR(20);
CREATE UNIQUE INDEX "ProdutoFinanceiro_publicCode_key" ON "ProdutoFinanceiro"("publicCode");
ALTER TABLE "TabelaValor" ADD COLUMN "publicCode" VARCHAR(20);
CREATE UNIQUE INDEX "TabelaValor_publicCode_key" ON "TabelaValor"("publicCode");
ALTER TABLE "Tarefa" ADD COLUMN "publicCode" VARCHAR(20);
CREATE UNIQUE INDEX "Tarefa_publicCode_key" ON "Tarefa"("publicCode");
ALTER TABLE "Usuario" ADD COLUMN "publicCode" VARCHAR(20);
CREATE UNIQUE INDEX "Usuario_publicCode_key" ON "Usuario"("publicCode");
ALTER TABLE "Evento" ADD COLUMN "publicCode" VARCHAR(20);
CREATE UNIQUE INDEX "Evento_publicCode_key" ON "Evento"("publicCode");
ALTER TABLE "Protocolo" ADD COLUMN "publicCode" VARCHAR(20);
CREATE UNIQUE INDEX "Protocolo_publicCode_key" ON "Protocolo"("publicCode");
ALTER TABLE "PhaseAutomationRule" ADD COLUMN "publicCode" VARCHAR(20);
CREATE UNIQUE INDEX "PhaseAutomationRule_publicCode_key" ON "PhaseAutomationRule"("publicCode");
