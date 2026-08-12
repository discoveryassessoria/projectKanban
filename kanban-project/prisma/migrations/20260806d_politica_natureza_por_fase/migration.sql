-- POLÍTICA DOCUMENTAL DA FASE — a fase declara as naturezas que aceita.
--
-- O QUE ISTO SUBSTITUI
-- --------------------
-- "A Genealogia só materializa CERTIDÕES" era uma premissa escrita no motor
-- (src/lib/documentos/natureza-certidao.ts, consumida por
-- materializar-genealogia). Enquanto ela viveu em código, incluir RG, CNH,
-- comprovante ou procuração na fase exigia mexer no motor — e cada inclusão
-- viraria um `if` por documento.
--
-- Agora a decisão é RELACIONAL e por ID: a fase declara quais
-- NaturezaOperacionalDocumento aceita; o TipoDocumentoCadastro declara a sua
-- (`naturezaOperacionalId`); a materialização compara os dois. Nenhum código
-- DOC, nenhum nome de documento, nenhum substring, nenhum array textual.
--
-- POR QUE `NaturezaOperacionalDocumento` E NÃO O CAMPO `nature`
-- ------------------------------------------------------------
-- `TipoDocumentoCadastro.nature` é string livre ("certidao", "identidade"…),
-- documentada no próprio schema como "config futura". `NaturezaOperacionalDocumento`
-- já É o cadastro mestre da natureza, com code, nome e `exigeWorkflow`, e o tipo
-- documental já tem FK para ela. Usar o cadastro que existe é o oposto de criar
-- uma segunda fonte.
--
-- QUEM RECEBE WORKFLOW CONTINUA SENDO DECIDIDO PELO PERFIL
-- -------------------------------------------------------
-- Esta tabela diz o que a fase ACEITA. Ela não diz o que ganha workflow: isso é
-- do PerfilOperacionalDocumento (que aponta o PhaseInternalWorkflow). Documento
-- sem perfil não recebe passo — é assim que RG e procuração entram na fase sem
-- herdar os cinco passos da emissão de certidão.
--
-- ADITIVA e IDEMPOTENTE: cria uma tabela nova e nada mais. Nenhuma linha
-- existente é lida, alterada ou removida.
--
-- ROLLBACK: DROP TABLE "FaseNaturezaPermitida";

CREATE TABLE IF NOT EXISTS "FaseNaturezaPermitida" (
    "id" SERIAL NOT NULL,
    "catalogoFaseId" INTEGER NOT NULL,
    "naturezaOperacionalId" INTEGER NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "FaseNaturezaPermitida_pkey" PRIMARY KEY ("id")
);

-- Uma linha por par: declarar duas vezes a mesma natureza para a mesma fase não
-- é configuração, é ruído.
CREATE UNIQUE INDEX IF NOT EXISTS "FaseNaturezaPermitida_catalogoFaseId_naturezaOperacionalId_key"
  ON "FaseNaturezaPermitida"("catalogoFaseId", "naturezaOperacionalId");
CREATE INDEX IF NOT EXISTS "FaseNaturezaPermitida_catalogoFaseId_idx"
  ON "FaseNaturezaPermitida"("catalogoFaseId");

-- CASCADE na fase: a política morre com a fase que a define.
-- RESTRICT na natureza: natureza usada por alguma fase não some do cadastro.
DO $$ BEGIN
  ALTER TABLE "FaseNaturezaPermitida" ADD CONSTRAINT "FaseNaturezaPermitida_catalogoFaseId_fkey"
    FOREIGN KEY ("catalogoFaseId") REFERENCES "CatalogoFase"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "FaseNaturezaPermitida" ADD CONSTRAINT "FaseNaturezaPermitida_naturezaOperacionalId_fkey"
    FOREIGN KEY ("naturezaOperacionalId") REFERENCES "NaturezaOperacionalDocumento"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
