-- ============================================================================
-- FIM DO ESPELHO — `Processo.pais` deixa de existir
-- ----------------------------------------------------------------------------
-- Esta migration é o último passo de uma migração feita em lotes. Ela só pôde
-- ser escrita depois que o compilador provou ZERO dependência: removendo `pais`
-- do modelo Prisma, `tsc` acusa 0 erros — nenhum select, nenhum writer, nenhum
-- DTO, nenhum mapper, nenhuma fixture.
--
-- AUDITORIA DE PRODUÇÃO IMEDIATAMENTE ANTES (números, não suposição):
--   Processo ......................... 2
--   paisId NULL ...................... 0
--   FK órfã .......................... 0
--   espelho divergente da identidade . 0
--   espelho vazio com identidade ..... 0
--   views/materialized views usando .. nenhuma
--
-- A PONTE TEMPORÁRIA MORRE JUNTO. O trigger que derivava o texto e o DEFAULT ''
-- existiam só para permitir que os writers parassem de escrever o espelho antes
-- da coluna sair. Nenhum dos dois é arquitetura: os dois saem aqui, e não fica
-- lógica equivalente escondida em lugar nenhum.
--
-- O QUE PERMANECE: `Processo.paisId` → `CatalogoPais`, com FK RESTRICT. País do
-- processo passa a ter uma identidade só, e o nome vira o que sempre deveria ter
-- sido — apresentação, resolvida na leitura pelo Cadastro Mestre.
-- ============================================================================

-- 1. A ponte primeiro: sem ela, o drop da coluna deixaria a função órfã.
DROP TRIGGER IF EXISTS "trg_processo_pais_espelho" ON "Processo";
DROP FUNCTION IF EXISTS "processo_pais_espelha_identidade"();

-- 2. Índice exclusivo do espelho.
DROP INDEX IF EXISTS "Processo_pais_idx";

-- 3. O DEFAULT temporário sai explicitamente antes da coluna — para ficar
--    registrado que a ponte foi desfeita, e não apenas arrastada pelo DROP.
ALTER TABLE "Processo" ALTER COLUMN "pais" DROP DEFAULT;

-- 4. A coluna.
ALTER TABLE "Processo" DROP COLUMN "pais";

-- `paisId`, sua FK e seu índice permanecem intocados: são a identidade.
