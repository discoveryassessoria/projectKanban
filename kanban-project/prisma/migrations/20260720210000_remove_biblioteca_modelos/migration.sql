-- REMOÇÃO DEFINITIVA da "Biblioteca de Modelos" (legado, config-time apenas).
-- Confirmado: NENHUM componente do motor operacional (materialização de fase, BlockingEngine,
-- PhaseAdvanceService, Operações Antecipadas, executor de automações) consulta estes modelos em
-- runtime. As colunas templateId nas tabelas de config oficiais são Int SOLTOS (sem FK) e ficam
-- preservadas (referência morta, inofensiva). Sem migração de dados: os modelos são o legado eliminado.

-- Filho primeiro (FK Cascade → ModeloWorkflowInterno)
DROP TABLE IF EXISTS "PassoWorkflowInterno";
DROP TABLE IF EXISTS "ModeloWorkflowInterno";
DROP TABLE IF EXISTS "ModeloInternoFase";
DROP TABLE IF EXISTS "ModeloAutomacao";
DROP TABLE IF EXISTS "ModeloTarefaTransversal";
