-- MOVIMENTAÇÃO MANUAL DE FASE — Administrador Master.
--
-- Reposicionar a fase atual de um processo para QUALQUER fase do workflow (anterior,
-- posterior ou intermediária), sem as validações do fluxo automático, é um fato
-- próprio: não é FORÇAR (forçar = o gate disse não e foi sobreposto) nem RETORNAR
-- (retorno só vai para trás). Dobrar a movimentação manual em um desses valores faria
-- a auditoria mentir sobre o que aconteceu — por isso valores dedicados.
--
-- ADITIVO e IDEMPOTENTE: só acrescenta valores de enum. Nenhum dado existente é lido,
-- alterado ou removido; nenhum comportamento atual muda.

ALTER TYPE "AdvanceResultado" ADD VALUE IF NOT EXISTS 'MOVIDO';
ALTER TYPE "WorkflowEventoTipo" ADD VALUE IF NOT EXISTS 'FASE_MOVIDA';
