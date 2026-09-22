-- Mandato "Reconstrução da hierarquia País/Tipo/Modalidade/Workflow Macro"
-- (22/09/2026) — PASSO 3 de 3: TIGHTEN. Roda só DEPOIS do backfill (passo 2,
-- scripts/migrar-hierarquia-pais-tipo-modalidade.ts) ter sido aplicado e
-- verificado (100% de cobertura provada, zero órfãos). Este passo:
--   1) remove as colunas/tabelas legadas (ModalidadeLegal, EnquadramentoLegal,
--      Processo.enquadramentoLegalId, TipoProcessoNacionalidade.modalidadeId)
--      — confirmado 0 Processo real usando enquadramentoLegalId antes de rodar;
--   2) aperta as colunas novas para NOT NULL (100% preenchidas pelo backfill);
--   3) trava ModalidadePais.modalityKey às duas canônicas (administrativa/
--      judicial) — nunca mais texto livre.
-- Backup dos dados removidos: docs/architecture/backups/modalidade-legal-enquadramento-legal-backup-20260922.json

BEGIN;

-- 1) Processo.enquadramentoLegalId — 0 linhas reais o usam (provado antes de aplicar)
ALTER TABLE "Processo" DROP CONSTRAINT IF EXISTS "Processo_enquadramentoLegalId_fkey";
DROP INDEX IF EXISTS "Processo_enquadramentoLegalId_idx";
ALTER TABLE "Processo" DROP COLUMN IF EXISTS "enquadramentoLegalId";

-- 2) EnquadramentoLegal / ModalidadeLegal — tabelas inteiras removidas
DROP TABLE IF EXISTS "EnquadramentoLegal";
DROP TABLE IF EXISTS "ModalidadeLegal";

-- 3) TipoProcessoNacionalidade.modalidadeId — FK único legado, substituído pela
--    N:N real (TipoProcessoModalidadeHabilitada), já com 100% dos Tipos migrados
ALTER TABLE "TipoProcessoNacionalidade" DROP CONSTRAINT IF EXISTS "TipoProcessoNacionalidade_modalidadeId_fkey";
DROP INDEX IF EXISTS "TipoProcessoNacionalidade_modalidadeId_idx";
ALTER TABLE "TipoProcessoNacionalidade" DROP COLUMN IF EXISTS "modalidadeId";

-- 4) Aperta pra NOT NULL — 100% preenchido pelo backfill (provado antes de aplicar)
ALTER TABLE "MacroWorkflow" ALTER COLUMN "modalidadeId" SET NOT NULL;
ALTER TABLE "MacroWorkflowVersao" ALTER COLUMN "modalidadeId" SET NOT NULL;
ALTER TABLE "MacroWorkflowVersao" ALTER COLUMN "cardinalidadeRequerimento" SET NOT NULL;

-- 5) Modalidade é enumeração canônica — só Administrativa e Judicial, nunca
--    texto livre (mandato: "impedir terceira modalidade por texto livre")
ALTER TABLE "ModalidadePais" ADD CONSTRAINT "ModalidadePais_modalityKey_canonica_check"
  CHECK ("modalityKey" IN ('administrativa', 'judicial'));

COMMIT;
