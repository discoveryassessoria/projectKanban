-- Alinha o banco ao schema.prisma (fonte de verdade), removendo drift pré-existente
-- introduzido fora do controle de migrations (db push de experimento abandonado).

-- CodeSequence.atualizadoEm é gerido por @updatedAt no app; remove default de banco.
ALTER TABLE "CodeSequence" ALTER COLUMN "atualizadoEm" DROP DEFAULT;

-- Colunas órfãs do "snapshot operacional por ciclo" (abordagem REJEITADA): não existem no
-- schema.prisma nem em nenhuma migration, e não há uso no código. PhaseWorkflowInstance vazia.
ALTER TABLE "PhaseWorkflowInstance" DROP COLUMN "operationalSnapshot",
DROP COLUMN "operationalSnapshotSchemaVersion";

-- Normaliza o nome do índice único (o banco tinha o nome truncado do db push).
ALTER INDEX "OperacaoAntecipada_processoId_necessidadeId_targetOperationT_ke" RENAME TO "OperacaoAntecipada_processoId_necessidadeId_targetOperation_key";
