-- CP-4D — sincronização Tarefa↔Passo: CAS otimista (lockVersion), executor,
-- motivo/justificativa, restauração de bloqueio e novos eventos.
-- ADITIVA e NÃO-DESTRUTIVA: só ADD VALUE (enums) + ADD COLUMN. Sem DROP.
-- lockVersion é NOT NULL com DEFAULT 0 (seguro p/ linhas existentes).
-- ATENÇÃO ROLLBACK: valores de enum PostgreSQL NÃO são removíveis trivialmente
-- (StatusTarefa.CANCELADA e os WorkflowEventoTipo permanecem no tipo).
-- Obs.: múltiplos ADD VALUE num só arquivo exigem PostgreSQL 12+ (Neon = ok).

-- AlterEnum
ALTER TYPE "WorkflowEventoTipo" ADD VALUE 'PASSO_AGUARDANDO_APROVACAO';
ALTER TYPE "WorkflowEventoTipo" ADD VALUE 'TAREFA_INICIADA';
ALTER TYPE "WorkflowEventoTipo" ADD VALUE 'TAREFA_BLOQUEADA';
ALTER TYPE "WorkflowEventoTipo" ADD VALUE 'TAREFA_DESBLOQUEADA';
ALTER TYPE "WorkflowEventoTipo" ADD VALUE 'TAREFA_SUPERSEDIDA';

-- AlterEnum
ALTER TYPE "StatusTarefa" ADD VALUE 'CANCELADA';

-- AlterTable
ALTER TABLE "Tarefa" ADD COLUMN     "blockedPreviousStatus" VARCHAR(30),
ADD COLUMN     "executedById" INTEGER,
ADD COLUMN     "justificativa" TEXT,
ADD COLUMN     "lockVersion" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "motivoCodigo" VARCHAR(40);

-- AlterTable
ALTER TABLE "PhaseWorkflowStepInstance" ADD COLUMN     "statusAnteriorBloqueio" VARCHAR(30);
