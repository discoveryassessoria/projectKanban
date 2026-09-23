-- Remoção integral do módulo "Prazos e SLA" e da tela "SLA" (pedido explícito
-- do usuário, 22-23/09/2026): remove PoliticaPrazoSla/PoliticaPrazoSlaVersao/
-- CalendarioOficial/FeriadoCalendario/EventoPrazoSla (0 linhas em produção,
-- confirmado antes desta migração) e as 7 colunas nullable que o mandato
-- "Prazos, SLA e Acompanhamento" (22/09/2026) havia acrescentado a Tarefa.
-- Não toca StepSubtaskDefinition/SubtaskExecution ("dois relógios") nem
-- nenhuma outra coluna pré-existente de Tarefa — Tarefa.dataPrazo permanece
-- intocado, é o único prazo que já existia antes deste módulo.

-- DropForeignKey
ALTER TABLE "EventoPrazoSla" DROP CONSTRAINT "EventoPrazoSla_tarefaId_fkey";

-- DropForeignKey
ALTER TABLE "FeriadoCalendario" DROP CONSTRAINT "FeriadoCalendario_calendarioId_fkey";

-- DropForeignKey
ALTER TABLE "PoliticaPrazoSlaVersao" DROP CONSTRAINT "PoliticaPrazoSlaVersao_politicaId_fkey";

-- DropForeignKey
ALTER TABLE "Tarefa" DROP CONSTRAINT "Tarefa_politicaPrazoSlaId_fkey";

-- DropForeignKey
ALTER TABLE "Tarefa" DROP CONSTRAINT "Tarefa_politicaPrazoSlaVersaoId_fkey";

-- DropForeignKey
ALTER TABLE "Tarefa" DROP CONSTRAINT "Tarefa_terceiroResponsavelId_fkey";

-- DropIndex
DROP INDEX "Tarefa_politicaPrazoSlaId_idx";

-- DropIndex
DROP INDEX "Tarefa_politicaPrazoSlaVersaoId_idx";

-- DropIndex
DROP INDEX "Tarefa_proximoAcompanhamentoEm_idx";

-- DropIndex
DROP INDEX "Tarefa_terceiroResponsavelId_idx";

-- AlterTable
ALTER TABLE "Tarefa" DROP COLUMN "aguardandoDesde",
DROP COLUMN "origemDaEspera",
DROP COLUMN "politicaPrazoSlaId",
DROP COLUMN "politicaPrazoSlaVersaoId",
DROP COLUMN "prazoBaseCalculoEm",
DROP COLUMN "proximoAcompanhamentoEm",
DROP COLUMN "terceiroResponsavelId";

-- DropTable
DROP TABLE "CalendarioOficial";

-- DropTable
DROP TABLE "EventoPrazoSla";

-- DropTable
DROP TABLE "FeriadoCalendario";

-- DropTable
DROP TABLE "PoliticaPrazoSla";

-- DropTable
DROP TABLE "PoliticaPrazoSlaVersao";

-- DropEnum
DROP TYPE "EstrategiaRetroacaoPrazoSla";

-- DropEnum
DROP TYPE "StatusPoliticaPrazoSla";

-- DropEnum
DROP TYPE "UnidadePrazoSla";
