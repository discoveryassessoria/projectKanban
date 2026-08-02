-- ============================================================================
-- Remoção DEFINITIVA do legado Processo.statusId (coluna + FK + índice) e da
-- ponte de fase Status.faseCode. A fase do processo passa a ser EXCLUSIVAMENTE
-- Processo.faseAtualKey (Workflow Macro/Interno + PhaseAdvanceService).
--
-- Autorizada como destrutiva: não há processos a preservar (base zerada
-- intencionalmente). SEM backfill, SEM cópia statusId→faseAtualKey, SEM backup.
--
-- Preserva a tabela "Status" e "Tarefa"."statusId" — Status continua sendo o
-- domínio de TAREFA. Nada de clientes/pessoas/tarefas/documentos é tocado.
-- IF EXISTS em todos os passos → idempotente e seguro contra reexecução.
-- ============================================================================

-- ── Processo: derruba FK, índice e a coluna legada statusId ─────────────────
ALTER TABLE "Processo" DROP CONSTRAINT IF EXISTS "Processo_statusId_fkey";
DROP INDEX IF EXISTS "Processo_statusId_idx";
ALTER TABLE "Processo" DROP COLUMN IF EXISTS "statusId";

-- ── Status.faseCode: era só a ponte legada de fase do PROCESSO (sem uso no
--    domínio de Tarefa). Removida junto com seu índice. ────────────────────────
DROP INDEX IF EXISTS "Status_faseCode_idx";
ALTER TABLE "Status" DROP COLUMN IF EXISTS "faseCode";
