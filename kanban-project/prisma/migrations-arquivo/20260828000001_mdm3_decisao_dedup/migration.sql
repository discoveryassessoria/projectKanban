-- MDM-3 F1 — Registro auditável da decisão de deduplicação.
--
-- ADITIVA e REVERSÍVEL: tabela nova. Nenhuma coluna existente é tocada e
-- nenhum caminho de escrita passa a exigir nada nesta fase — a obrigatoriedade
-- em POST /api/pessoas entra na F3, depois do inventário de chamadores.
-- Idempotente.

CREATE TABLE IF NOT EXISTS "DecisaoDeduplicacao" (
    "id" SERIAL NOT NULL,
    "chaveDedup" VARCHAR(200) NOT NULL,
    "candidatosAvaliados" JSONB NOT NULL,
    "nivelTriagem" VARCHAR(14) NOT NULL,
    "decisao" VARCHAR(20) NOT NULL,
    "pessoaResultanteId" INTEGER,
    "justificativa" VARCHAR(500),
    "decididoPorId" INTEGER,
    "decididoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "chaveIdempotencia" VARCHAR(200) NOT NULL,
    CONSTRAINT "DecisaoDeduplicacao_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "DecisaoDeduplicacao_chaveIdempotencia_key" ON "DecisaoDeduplicacao"("chaveIdempotencia");
CREATE INDEX IF NOT EXISTS "DecisaoDeduplicacao_chaveDedup_idx" ON "DecisaoDeduplicacao"("chaveDedup");
CREATE INDEX IF NOT EXISTS "DecisaoDeduplicacao_pessoaResultanteId_idx" ON "DecisaoDeduplicacao"("pessoaResultanteId");
CREATE INDEX IF NOT EXISTS "DecisaoDeduplicacao_decididoEm_idx" ON "DecisaoDeduplicacao"("decididoEm");

DO $$ BEGIN
    ALTER TABLE "DecisaoDeduplicacao" ADD CONSTRAINT "DecisaoDeduplicacao_pessoaResultanteId_fkey"
        FOREIGN KEY ("pessoaResultanteId") REFERENCES "Pessoa"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE "DecisaoDeduplicacao" ADD CONSTRAINT "DecisaoDeduplicacao_decididoPorId_fkey"
        FOREIGN KEY ("decididoPorId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE "DecisaoDeduplicacao" ADD CONSTRAINT "DecisaoDeduplicacao_decisao_check"
        CHECK ("decisao" IN ('CRIOU_NOVA','VINCULOU_EXISTENTE'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE "DecisaoDeduplicacao" ADD CONSTRAINT "DecisaoDeduplicacao_nivel_check"
        CHECK ("nivelTriagem" IN ('BLOQUEIO','CONFIRMACAO','INFORMATIVO','LIVRE'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Bloqueio por CPF nunca resulta em criação: se essa linha existir, houve
-- caminho de escrita que ignorou a triagem.
DO $$ BEGIN
    ALTER TABLE "DecisaoDeduplicacao" ADD CONSTRAINT "DecisaoDeduplicacao_bloqueio_nao_cria_check"
        CHECK ("nivelTriagem" <> 'BLOQUEIO' OR "decisao" = 'VINCULOU_EXISTENTE');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Criar apesar de candidato forte exige justificativa escrita.
DO $$ BEGIN
    ALTER TABLE "DecisaoDeduplicacao" ADD CONSTRAINT "DecisaoDeduplicacao_confirmacao_justifica_check"
        CHECK ("nivelTriagem" <> 'CONFIRMACAO' OR "decisao" = 'VINCULOU_EXISTENTE'
               OR ("justificativa" IS NOT NULL AND length(btrim("justificativa")) > 0));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
