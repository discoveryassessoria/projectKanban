-- CreateEnum
CREATE TYPE "ModoSatisfacaoRequisito" AS ENUM ('QUALQUER_UM_ATENDE', 'TODOS_SAO_EXIGIDOS');

-- AlterTable
ALTER TABLE "MatrizDocumental" ADD COLUMN     "aplicaTodosProcessos" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "documentosAceitos" JSONB,
ADD COLUMN     "modoSatisfacao" "ModoSatisfacaoRequisito" NOT NULL DEFAULT 'QUALQUER_UM_ATENDE',
ADD COLUMN     "publicosAlvo" JSONB,
ADD COLUMN     "requisitoNome" VARCHAR(200),
ADD COLUMN     "tipoProcessoIds" JSONB;


-- ============================================================
-- ADAPTAÇÃO (seção 9) — preserva tudo; só preenche as novas colunas.
-- Coleções recebem 1 item (compatibilidade). Público "linha reta"/"fora" vira
-- "Pessoa da árvore" (TODAS_AS_PESSOAS_DA_ARVORE) + condição linhaReta=true/false.
-- Não publica nada; status permanece.
-- ============================================================
-- 1) coleções de 1 item + nome do requisito
UPDATE "MatrizDocumental" SET
  "tipoProcessoIds"   = to_jsonb(ARRAY["tipoProcessoId"]),
  "documentosAceitos" = to_jsonb(ARRAY["documentTypeCode"]),
  "requisitoNome"     = COALESCE("requisitoNome", "nome", "documentTypeCode")
WHERE "tipoProcessoIds" IS NULL;

-- 2) linha reta / fora da linha → Pessoa da árvore + condição linhaReta
UPDATE "MatrizDocumental" SET
  "publicosAlvo" = jsonb_build_array('TODAS_AS_PESSOAS_DA_ARVORE'),
  "condicoes" = jsonb_build_object(
    'combinador', COALESCE("condicoes"->>'combinador', 'TODAS'),
    'regras', COALESCE("condicoes"->'regras', '[]'::jsonb) || jsonb_build_array(
      jsonb_build_object('campo', 'linhaReta', 'operador', 'igual', 'valor', ("publicoAlvo" = 'PESSOA_DA_LINHA_RETA'))
    )
  )
WHERE "publicosAlvo" IS NULL AND "publicoAlvo" IN ('PESSOA_DA_LINHA_RETA', 'PESSOA_FORA_DA_LINHA_RETA');

-- 3) demais públicos → coleção com o próprio público
UPDATE "MatrizDocumental" SET
  "publicosAlvo" = jsonb_build_array("publicoAlvo"::text)
WHERE "publicosAlvo" IS NULL;
