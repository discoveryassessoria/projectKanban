-- APAGAR UM PROCESSO PASSA A LEVAR A TRILHA DELE JUNTO.
--
-- Doze tabelas guardavam `processoId` como inteiro solto, SEM chave estrangeira.
-- Sem a constraint o banco não tinha como cascatear: excluir um processo deixava
-- para trás tudo que falava dele. A limpeza de produção deixou 174 eventos de
-- workflow, 127 registros de avanço de fase e 11 obrigações econômicas
-- apontando para processos que não existem mais.
--
-- E isso aparecia na tela: o relatório Financeiro mostrava "11 obrigações", e as
-- onze eram de processos deletados — € 30.800 de recebível fantasma.
--
-- Os órfãos foram removidos antes desta migration (a constraint não nasce com a
-- tabela suja). Daqui em diante o banco recusa: ON DELETE CASCADE em todas.
--
-- CASCADE, e não RESTRICT, porque a regra do produto é explícita — apagar uma
-- coisa apaga o que só existia por causa dela. Vale inclusive para
-- `ObrigacaoEconomica`: se um dia for preciso PROTEGER o financeiro da exclusão,
-- isso é regra de negócio na porta (com mensagem para o operador), não um erro
-- de integridade cru vindo do banco.

ALTER TABLE "WorkflowEvento"            ADD CONSTRAINT "WorkflowEvento_processoId_fkey"            FOREIGN KEY ("processoId") REFERENCES "Processo"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PhaseAdvanceLog"           ADD CONSTRAINT "PhaseAdvanceLog_processoId_fkey"           FOREIGN KEY ("processoId") REFERENCES "Processo"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PhaseWorkflowStepInstance" ADD CONSTRAINT "PhaseWorkflowStepInstance_processoId_fkey" FOREIGN KEY ("processoId") REFERENCES "Processo"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OperacaoAntecipada"        ADD CONSTRAINT "OperacaoAntecipada_processoId_fkey"        FOREIGN KEY ("processoId") REFERENCES "Processo"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ParteExterna"              ADD CONSTRAINT "ParteExterna_processoId_fkey"              FOREIGN KEY ("processoId") REFERENCES "Processo"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SolicitacaoDocumento"      ADD CONSTRAINT "SolicitacaoDocumento_processoId_fkey"      FOREIGN KEY ("processoId") REFERENCES "Processo"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Cobranca"                  ADD CONSTRAINT "Cobranca_processoId_fkey"                  FOREIGN KEY ("processoId") REFERENCES "Processo"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ContaPagar"                ADD CONSTRAINT "ContaPagar_processoId_fkey"                FOREIGN KEY ("processoId") REFERENCES "Processo"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CreditoMovimento"          ADD CONSTRAINT "CreditoMovimento_processoId_fkey"          FOREIGN KEY ("processoId") REFERENCES "Processo"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Transacao"                 ADD CONSTRAINT "Transacao_processoId_fkey"                 FOREIGN KEY ("processoId") REFERENCES "Processo"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TabelaValor"               ADD CONSTRAINT "TabelaValor_processoId_fkey"               FOREIGN KEY ("processoId") REFERENCES "Processo"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ObrigacaoEconomica"        ADD CONSTRAINT "ObrigacaoEconomica_processoId_fkey"        FOREIGN KEY ("processoId") REFERENCES "Processo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- SE SOBROU ÓRFÃO, A MIGRATION PARA. Constraint criada sobre tabela suja é
-- constraint que mente: o Postgres a valida na criação, mas um NOT VALID mudo
-- passaria batido. Este bloco confirma que a limpeza foi completa.
DO $$
DECLARE n INTEGER;
BEGIN
  SELECT COUNT(*) INTO n FROM "WorkflowEvento" x
   WHERE x."processoId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "Processo" p WHERE p.id = x."processoId");
  IF n > 0 THEN RAISE EXCEPTION 'ainda existem % evento(s) órfão(s)', n; END IF;
END $$;
