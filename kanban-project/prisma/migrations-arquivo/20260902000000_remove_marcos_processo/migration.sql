-- Remoção definitiva do cadastro "Marcos do processo" (Gerenciamento › Processos).
-- Eventos importantes do processo passam a ter uma ÚNICA fonte de registro
-- cronológico: a Timeline/Histórico do Processo (WorkflowEvento + Evento +
-- LogAuditoria). Nenhum outro objeto do banco referencia "MarcoProcesso" — a
-- tabela era um cadastro puro, sem FK de entrada nem uso em runtime.
-- Idempotente: só executa se a tabela existir.

DROP TABLE IF EXISTS "MarcoProcesso";
