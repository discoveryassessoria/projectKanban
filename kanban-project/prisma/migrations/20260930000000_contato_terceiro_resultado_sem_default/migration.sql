-- Alinha o banco ao schema.prisma: `ContatoTerceiro.resultado` é OBRIGATÓRIO (cobrança sem
-- resposta é um FATO registrado, nunca um default silencioso). A migration
-- 20260929120000 pôs `DEFAULT 'SEM_RESPOSTA'` só para o backfill das linhas antigas; o
-- default nunca deveria ter ficado. Achado pelo banco de teste montado com as migrations de
-- produção (scripts/ci/criar-banco-de-teste.mjs — "zero diferença contra o schema").
-- Só metadado da coluna: nenhum dado é alterado; todo INSERT do código já informa `resultado`
-- (o tipo do Prisma o exige).
ALTER TABLE "ContatoTerceiro" ALTER COLUMN "resultado" DROP DEFAULT;
