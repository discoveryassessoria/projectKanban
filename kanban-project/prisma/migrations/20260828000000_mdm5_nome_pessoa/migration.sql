-- MDM-5 F1 — Nomes alternativos (aliases) da Pessoa.
--
-- ADITIVA e REVERSÍVEL: cria uma tabela nova e NÃO toca em nenhuma coluna
-- existente. Pessoa.nome/sobrenome permanecem exatamente como estão — a
-- inversão de fonte (Pessoa vira projeção do nome principal) acontece só na
-- fase 3, depois do backfill e do dual-write. Nesta fase ninguém lê a tabela.
--
-- Idempotente: pode rodar duas vezes sem erro.

CREATE TABLE IF NOT EXISTS "NomePessoa" (
    "id" SERIAL NOT NULL,
    "pessoaId" INTEGER NOT NULL,
    "nome" VARCHAR(50) NOT NULL,
    "sobrenome" VARCHAR(40),
    "tipo" VARCHAR(20) NOT NULL,
    "principal" BOOLEAN NOT NULL DEFAULT false,
    "chaveFonetica" VARCHAR(60),
    -- afirmação auditável (complemento 2 da arquitetura aprovada)
    "origem" VARCHAR(16) NOT NULL,
    "confianca" VARCHAR(12) NOT NULL,
    "responsavelId" INTEGER,
    "afirmadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "justificativa" VARCHAR(300),
    "evidenciaNecessidadeId" INTEGER,
    -- histórico append-only
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "supersedidoPorId" INTEGER,
    "chaveIdempotencia" VARCHAR(200) NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "NomePessoa_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "NomePessoa_chaveIdempotencia_key" ON "NomePessoa"("chaveIdempotencia");
CREATE UNIQUE INDEX IF NOT EXISTS "NomePessoa_supersedidoPorId_key" ON "NomePessoa"("supersedidoPorId");
CREATE INDEX IF NOT EXISTS "NomePessoa_pessoaId_idx" ON "NomePessoa"("pessoaId");
CREATE INDEX IF NOT EXISTS "NomePessoa_chaveFonetica_idx" ON "NomePessoa"("chaveFonetica");
CREATE INDEX IF NOT EXISTS "NomePessoa_pessoaId_principal_idx" ON "NomePessoa"("pessoaId", "principal");

-- INVARIANTE: no máximo UM nome principal ATIVO por pessoa. Vive no banco, não
-- só no serviço: dois principais tornam a projeção de Pessoa.nome ambígua e o
-- erro só apareceria muito depois, na tela.
CREATE UNIQUE INDEX IF NOT EXISTS "NomePessoa_um_principal_ativo"
    ON "NomePessoa"("pessoaId") WHERE ("principal" = true AND "ativo" = true);

DO $$ BEGIN
    ALTER TABLE "NomePessoa" ADD CONSTRAINT "NomePessoa_pessoaId_fkey"
        FOREIGN KEY ("pessoaId") REFERENCES "Pessoa"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE "NomePessoa" ADD CONSTRAINT "NomePessoa_responsavelId_fkey"
        FOREIGN KEY ("responsavelId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE "NomePessoa" ADD CONSTRAINT "NomePessoa_evidenciaNecessidadeId_fkey"
        FOREIGN KEY ("evidenciaNecessidadeId") REFERENCES "NecessidadeDocumental"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE "NomePessoa" ADD CONSTRAINT "NomePessoa_supersedidoPorId_fkey"
        FOREIGN KEY ("supersedidoPorId") REFERENCES "NomePessoa"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Grau de confiança e origem só aceitam os valores da escala única do Discovery
-- (src/lib/cadastro-mestre/afirmacao.ts). Escala divergente entre domínios faz
-- "provável" significar coisas diferentes em duas telas do mesmo sistema.
DO $$ BEGIN
    ALTER TABLE "NomePessoa" ADD CONSTRAINT "NomePessoa_confianca_check"
        CHECK ("confianca" IN ('CONFIRMADO','PROVAVEL','HIPOTESE','CONTESTADO'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE "NomePessoa" ADD CONSTRAINT "NomePessoa_origem_check"
        CHECK ("origem" IN ('DOCUMENTO','OPERADOR','IMPORTACAO','REQUERENTE','MOTOR','IA'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE "NomePessoa" ADD CONSTRAINT "NomePessoa_tipo_check"
        CHECK ("tipo" IN ('REGISTRAL','NASCIMENTO','CASADA','RELIGIOSO','GRAFIA_DOCUMENTO','APORTUGUESADO','IMPORTADO'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- IA nunca nasce como fato. A regra vive no serviço E aqui: o banco é a última
-- linha de defesa contra um caminho de escrita que esqueça a validação.
DO $$ BEGIN
    ALTER TABLE "NomePessoa" ADD CONSTRAINT "NomePessoa_ia_nao_confirma_check"
        CHECK ("origem" <> 'IA' OR "confianca" IN ('HIPOTESE','CONTESTADO'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
