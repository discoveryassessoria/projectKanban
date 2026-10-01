-- TORRE NOVA (M4) — TOTAIS DA VISÃO GERAL NA FOTO DIÁRIA ("▲/▼ vs semana passada").
--
-- Colunas NULLABLE e sem default: foto antiga NÃO tem estes números e NUNCA é preenchida depois —
-- a tela mostra "sem tendência", jamais uma estimativa. Escritas daqui para frente pelo cron
-- /api/cron/torre-indicadores.
--   processosAtivos  grain PROCESSO (processos abertos e não pausados)
--   tarefasAbertas   grain TAREFA   (a aba Tarefas)
--   comEquipe        grain TAREFA   (partição: com responsável e bola nossa)
--   comCartorio      grain TAREFA   ("Aguardando terceiros" do cartão: COM responsável; `aguardandoTerceiro` conta com ou sem dono)
--
-- ADITIVA e IDEMPOTENTE.

ALTER TABLE "TorreIndicadorDiario" ADD COLUMN IF NOT EXISTS "processosAtivos" INTEGER;
ALTER TABLE "TorreIndicadorDiario" ADD COLUMN IF NOT EXISTS "tarefasAbertas" INTEGER;
ALTER TABLE "TorreIndicadorDiario" ADD COLUMN IF NOT EXISTS "comEquipe" INTEGER;
ALTER TABLE "TorreIndicadorDiario" ADD COLUMN IF NOT EXISTS "comCartorio" INTEGER;
