-- 1. Criar o enum StatusPost
CREATE TYPE "StatusPost" AS ENUM ('RASCUNHO', 'PUBLICADO', 'ARQUIVADO');

-- 2. Criar a tabela BlogPost
CREATE TABLE "BlogPost" (
    "id" SERIAL PRIMARY KEY,
    "titulo" VARCHAR(200) NOT NULL,
    "slug" VARCHAR(220) NOT NULL UNIQUE,
    "resumo" VARCHAR(500) NOT NULL,
    "conteudo" TEXT,
    "imagemUrl" TEXT,
    "imagemAlt" VARCHAR(200),
    "categoria" VARCHAR(100) NOT NULL,
    "tempoLeitura" INTEGER NOT NULL DEFAULT 5,
    "status" "StatusPost" NOT NULL DEFAULT 'RASCUNHO',
    "destaque" BOOLEAN NOT NULL DEFAULT false,
    "dataPublicacao" TIMESTAMP(3),
    "metaTitle" VARCHAR(70),
    "metaDescription" VARCHAR(160),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL
);

-- 3. Criar os índices
CREATE INDEX "BlogPost_status_idx" ON "BlogPost"("status");
CREATE INDEX "BlogPost_dataPublicacao_idx" ON "BlogPost"("dataPublicacao");
CREATE INDEX "BlogPost_categoria_idx" ON "BlogPost"("categoria");
CREATE INDEX "BlogPost_destaque_idx" ON "BlogPost"("destaque");