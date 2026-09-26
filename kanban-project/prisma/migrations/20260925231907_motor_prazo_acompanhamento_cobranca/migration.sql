-- Motor de prazo, acompanhamento e cobrança (mandato 25/09/2026).
--
-- Escopo estritamente aditivo: novas colunas com DEFAULT seguro em tabelas
-- existentes + uma tabela nova (ContatoTerceiro). Nenhum DROP, nenhuma
-- coluna existente alterada, nenhum dado tocado.
--
-- NÃO INCLUI drift pré-existente encontrado por `prisma migrate diff` entre
-- o banco vivo e o histórico de migrations (DROP de índices/constraints em
-- ClienteAuth/DocumentoGerado/MatrizDocumental/Processo/RetificacaoPacote/
-- SolicitacaoDocumento, ALTER COLUMN em CategoriaProfissional/Profissional/
-- RegistroProfissional) — isso é anterior a esta mudança e não faz parte
-- deste mandato; reportado à parte, não aplicado aqui.

-- AlterTable: PhaseInternalWorkflowStep — os três parâmetros do cadastro da
-- etapa (a iniciar / cobrança / escalada), nunca hardcoded no motor.
ALTER TABLE "PhaseInternalWorkflowStep"
  ADD COLUMN "diasParaIniciar" INTEGER DEFAULT 2,
  ADD COLUMN "diasAposCobranca" INTEGER DEFAULT 1,
  ADD COLUMN "escalarApos" INTEGER DEFAULT 2;

-- AlterTable: StepSubtaskDefinition — qual subtarefa define o prazo da
-- Tarefa (e em quantos dias corridos), quando ela vira corrente.
ALTER TABLE "StepSubtaskDefinition"
  ADD COLUMN "definePrazoDaTarefa" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "prazoDaTarefaDias" INTEGER;

-- AlterTable: SubtaskExecution — escalada por cobranças sem resposta.
ALTER TABLE "SubtaskExecution"
  ADD COLUMN "escalada" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "escaladaEm" TIMESTAMP(3);

-- CreateTable: ContatoTerceiro — a cobrança ao terceiro, registrada como
-- fato (quem, quando, canal). Nunca confundir com o model `Cobranca`
-- (financeiro — cliente/receita, domínio diferente).
CREATE TABLE "ContatoTerceiro" (
    "id" SERIAL NOT NULL,
    "subtaskExecutionId" INTEGER NOT NULL,
    "tarefaId" INTEGER NOT NULL,
    "documentoId" INTEGER,
    "orgaoId" INTEGER,
    "canal" VARCHAR(20) NOT NULL,
    "observacao" TEXT,
    "registradoPorId" INTEGER,
    "registradoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContatoTerceiro_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ContatoTerceiro_subtaskExecutionId_idx" ON "ContatoTerceiro"("subtaskExecutionId");
CREATE INDEX "ContatoTerceiro_tarefaId_idx" ON "ContatoTerceiro"("tarefaId");
CREATE INDEX "ContatoTerceiro_orgaoId_idx" ON "ContatoTerceiro"("orgaoId");

ALTER TABLE "ContatoTerceiro" ADD CONSTRAINT "ContatoTerceiro_subtaskExecutionId_fkey"
  FOREIGN KEY ("subtaskExecutionId") REFERENCES "SubtaskExecution"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ContatoTerceiro" ADD CONSTRAINT "ContatoTerceiro_documentoId_fkey"
  FOREIGN KEY ("documentoId") REFERENCES "Documento"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ContatoTerceiro" ADD CONSTRAINT "ContatoTerceiro_orgaoId_fkey"
  FOREIGN KEY ("orgaoId") REFERENCES "OrgaoProtocolo"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ContatoTerceiro" ADD CONSTRAINT "ContatoTerceiro_registradoPorId_fkey"
  FOREIGN KEY ("registradoPorId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;
