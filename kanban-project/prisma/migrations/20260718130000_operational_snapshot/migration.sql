-- Infraestrutura de SNAPSHOT DA PROJEÇÃO OPERACIONAL por ciclo (Central única OPERATE|VIEW).
-- Armazena, na CONCLUSÃO do ciclo, o payload que a Central Operacional consome para renderizar
-- a fase — imutável. A consulta histórica (VIEW) desserializa esta projeção; nunca reconstrói a
-- tela a partir de tabelas vivas do domínio.
--
-- ADITIVO / NÃO-DESTRUTIVO: apenas duas colunas nullable. Nenhum dado é alterado ou removido.
-- Instâncias concluídas antes desta migration ficam com operationalSnapshot = NULL (VIEW sinaliza
-- "projeção histórica não capturada neste ciclo").

ALTER TABLE "PhaseWorkflowInstance"
  ADD COLUMN "operationalSnapshot" JSONB,
  ADD COLUMN "operationalSnapshotSchemaVersion" INTEGER;
