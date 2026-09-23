-- Separação Biblioteca de Tarefas × Workflow Interno (mandato 22/09/2026,
-- correção da mesma data). Remove a entidade "Vínculo" (tipo+modalidade+fase
-- à parte, 0 linhas em produção, nunca usada) e substitui por dois campos no
-- próprio passo do Workflow Interno: `bibliotecaModeloId`/
-- `bibliotecaModeloVersao` — a fase JÁ tem Workflow Interno escopado por
-- tipo; só falta ele poder dizer "este passo é este Modelo, nesta versão".
-- Nenhuma linha de PhaseInternalWorkflowStep, StepAction, StepField,
-- StepSubtaskDefinition ou qualquer outra tabela existente é alterada por
-- esta migração — puramente aditiva/remoção de tabela vazia.

-- DropForeignKey
ALTER TABLE "BibliotecaVinculo" DROP CONSTRAINT "BibliotecaVinculo_modalidadeId_fkey";

-- DropForeignKey
ALTER TABLE "BibliotecaVinculo" DROP CONSTRAINT "BibliotecaVinculo_modeloId_fkey";

-- DropForeignKey
ALTER TABLE "BibliotecaVinculo" DROP CONSTRAINT "BibliotecaVinculo_tipoProcessoId_fkey";

-- DropForeignKey
ALTER TABLE "BibliotecaVinculoVersao" DROP CONSTRAINT "BibliotecaVinculoVersao_vinculoId_fkey";

-- AlterTable
ALTER TABLE "PhaseInternalWorkflowStep" ADD COLUMN "bibliotecaModeloId" INTEGER,
ADD COLUMN "bibliotecaModeloVersao" INTEGER;

-- DropTable
DROP TABLE "BibliotecaVinculo";

-- DropTable
DROP TABLE "BibliotecaVinculoVersao";

-- DropEnum
DROP TYPE "BibliotecaVinculoStatus";

-- CreateIndex
CREATE INDEX "PhaseInternalWorkflowStep_bibliotecaModeloId_idx" ON "PhaseInternalWorkflowStep"("bibliotecaModeloId");

-- AddForeignKey
ALTER TABLE "PhaseInternalWorkflowStep" ADD CONSTRAINT "PhaseInternalWorkflowStep_bibliotecaModeloId_fkey" FOREIGN KEY ("bibliotecaModeloId") REFERENCES "BibliotecaModeloTarefa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
