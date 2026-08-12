-- A CAMADA OPERACIONAL DO FUNCIONÁRIO — aptidão, indisponibilidade e capacidade.
--
-- Migration ADITIVA: três tabelas novas e um enum. Nenhuma tabela existente é
-- alterada, nenhuma coluna é removida, nenhum dado é tocado. A organização
-- (equipe) NÃO é criada aqui porque já existe: `GrupoUsuario` +
-- `GrupoUsuarioMembro`, com cadastro próprio.
--
-- Nada disto concede permissão. Autorização continua inteiramente em
-- Perfil/permissoesCustom — estas estruturas só restringem quem já pode.

CREATE TYPE "TipoIndisponibilidade" AS ENUM ('FERIAS', 'AFASTAMENTO', 'AUSENCIA', 'BLOQUEIO_OPERACIONAL');

CREATE TABLE "AptidaoOperacional" (
    "id" SERIAL NOT NULL,
    "usuarioId" INTEGER NOT NULL,
    "faseKey" VARCHAR(60) NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AptidaoOperacional_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AptidaoOperacional_usuarioId_faseKey_key" ON "AptidaoOperacional"("usuarioId", "faseKey");
CREATE INDEX "AptidaoOperacional_faseKey_idx" ON "AptidaoOperacional"("faseKey");
ALTER TABLE "AptidaoOperacional" ADD CONSTRAINT "AptidaoOperacional_usuarioId_fkey"
  FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "IndisponibilidadeOperacional" (
    "id" SERIAL NOT NULL,
    "usuarioId" INTEGER NOT NULL,
    "tipo" "TipoIndisponibilidade" NOT NULL,
    "inicio" TIMESTAMP(3) NOT NULL,
    "fim" TIMESTAMP(3),
    "motivo" VARCHAR(300),
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "criadoPorId" INTEGER,
    CONSTRAINT "IndisponibilidadeOperacional_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "IndisponibilidadeOperacional_usuarioId_inicio_idx" ON "IndisponibilidadeOperacional"("usuarioId", "inicio");
CREATE INDEX "IndisponibilidadeOperacional_fim_idx" ON "IndisponibilidadeOperacional"("fim");
ALTER TABLE "IndisponibilidadeOperacional" ADD CONSTRAINT "IndisponibilidadeOperacional_usuarioId_fkey"
  FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "IndisponibilidadeOperacional" ADD CONSTRAINT "IndisponibilidadeOperacional_criadoPorId_fkey"
  FOREIGN KEY ("criadoPorId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "CapacidadeOperacional" (
    "id" SERIAL NOT NULL,
    "usuarioId" INTEGER NOT NULL,
    "limiteExecutaveis" INTEGER,
    "observacao" VARCHAR(300),
    "atualizadoEm" TIMESTAMP(3) NOT NULL,
    "atualizadoPorId" INTEGER,
    CONSTRAINT "CapacidadeOperacional_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CapacidadeOperacional_usuarioId_key" ON "CapacidadeOperacional"("usuarioId");
ALTER TABLE "CapacidadeOperacional" ADD CONSTRAINT "CapacidadeOperacional_usuarioId_fkey"
  FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CapacidadeOperacional" ADD CONSTRAINT "CapacidadeOperacional_atualizadoPorId_fkey"
  FOREIGN KEY ("atualizadoPorId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;
