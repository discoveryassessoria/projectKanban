#!/usr/bin/env bash
# Valida as migrations MDM contra um PostgreSQL REAL, antes de tocar produção.
#
# Por que existe: os testes de `npm run test:mdm` provam a lógica, mas não
# provam que o CHECK e o índice parcial realmente bloqueiam no banco. Aqui a
# migration é aplicada, REAPLICADA (idempotência) e cada invariante é violada
# de propósito para confirmar que o banco recusa.
#
# Roda num banco descartável (`mdm_check`), nunca no oficial. Exige .env.test.
# Uso: bash scripts/mdm-migrations-validar.sh
set -euo pipefail
cd "$(dirname "$0")/.."

[ -f .env.test ] || { echo "ERRO: .env.test ausente."; exit 1; }
set -a; . ./.env.test; set +a

npx tsx scripts/guard-nonprod-db.ts >/dev/null || { echo "ERRO: guard de não-produção recusou."; exit 1; }

ADMIN=$(echo "$DIRECT_DATABASE_URL" | sed -E 's#\?.*$##; s#/[^/]+$#/postgres#')
ALVO=$(echo "$DIRECT_DATABASE_URL"  | sed -E 's#\?.*$##; s#/[^/]+$#/mdm_check#')

psql "$ADMIN" -tAc "DROP DATABASE IF EXISTS mdm_check;" >/dev/null
psql "$ADMIN" -tAc "CREATE DATABASE mdm_check;" >/dev/null

# Pré-requisitos mínimos: só as tabelas que as migrations referenciam.
psql "$ALVO" -q <<'SQL'
CREATE TABLE "Pessoa" ("id" SERIAL PRIMARY KEY, "nome" VARCHAR(50) NOT NULL, "sobrenome" VARCHAR(40));
CREATE TABLE "Usuario" ("id" SERIAL PRIMARY KEY, "nome" VARCHAR(100));
CREATE TABLE "NecessidadeDocumental" ("id" SERIAL PRIMARY KEY);
SQL

for m in 20260828000000_mdm5_nome_pessoa 20260828000001_mdm3_decisao_dedup; do
  psql "$ALVO" -q -v ON_ERROR_STOP=1 -f "prisma/migrations/$m/migration.sql" >/dev/null
  echo "  ✅ $m aplicada"
  psql "$ALVO" -q -v ON_ERROR_STOP=1 -f "prisma/migrations/$m/migration.sql" >/dev/null 2>&1
  echo "  ✅ $m reaplicada (idempotente)"
done

psql "$ALVO" -q -tA <<'SQL'
INSERT INTO "Pessoa"("nome") VALUES ('Giovanni');
INSERT INTO "Usuario"("nome") VALUES ('Operador');
INSERT INTO "NomePessoa"("pessoaId","nome","tipo","principal","origem","confianca","responsavelId","justificativa","chaveIdempotencia")
VALUES (1,'Giovanni','REGISTRAL',true,'OPERADOR','PROVAVEL',1,'x','k1');
\echo '  ✅ primeiro nome principal aceito'

DO $$ BEGIN
  INSERT INTO "NomePessoa"("pessoaId","nome","tipo","principal","origem","confianca","responsavelId","justificativa","chaveIdempotencia")
  VALUES (1,'Giovanna','CASADA',true,'OPERADOR','PROVAVEL',1,'x','k2');
  RAISE EXCEPTION 'FALHOU: segundo principal aceito';
EXCEPTION WHEN unique_violation THEN RAISE NOTICE '  OK segundo principal ativo BLOQUEADO'; END $$;

DO $$ BEGIN
  INSERT INTO "NomePessoa"("pessoaId","nome","tipo","origem","confianca","justificativa","chaveIdempotencia")
  VALUES (1,'S','IMPORTADO','IA','CONFIRMADO','x','k3');
  RAISE EXCEPTION 'FALHOU: IA confirmada aceita';
EXCEPTION WHEN check_violation THEN RAISE NOTICE '  OK IA como CONFIRMADO BLOQUEADO'; END $$;

INSERT INTO "NomePessoa"("pessoaId","nome","tipo","origem","confianca","justificativa","chaveIdempotencia")
VALUES (1,'S','IMPORTADO','IA','HIPOTESE','x','k4');
\echo '  ✅ IA como HIPOTESE aceita'

DO $$ BEGIN
  INSERT INTO "NomePessoa"("pessoaId","nome","tipo","origem","confianca","justificativa","chaveIdempotencia")
  VALUES (1,'X','IMPORTADO','OPERADOR','TALVEZ','x','k5');
  RAISE EXCEPTION 'FALHOU: confianca invalida aceita';
EXCEPTION WHEN check_violation THEN RAISE NOTICE '  OK confianca fora da escala BLOQUEADA'; END $$;

DO $$ BEGIN
  INSERT INTO "DecisaoDeduplicacao"("chaveDedup","candidatosAvaliados","nivelTriagem","decisao","chaveIdempotencia")
  VALUES ('cpf:1','[]'::jsonb,'BLOQUEIO','CRIOU_NOVA','d1');
  RAISE EXCEPTION 'FALHOU: bloqueio que criou aceito';
EXCEPTION WHEN check_violation THEN RAISE NOTICE '  OK BLOQUEIO+CRIOU_NOVA BLOQUEADO'; END $$;

DO $$ BEGIN
  INSERT INTO "DecisaoDeduplicacao"("chaveDedup","candidatosAvaliados","nivelTriagem","decisao","chaveIdempotencia")
  VALUES ('nome:x','[]'::jsonb,'CONFIRMACAO','CRIOU_NOVA','d2');
  RAISE EXCEPTION 'FALHOU: criou sem justificativa';
EXCEPTION WHEN check_violation THEN RAISE NOTICE '  OK CONFIRMACAO sem justificativa BLOQUEADA'; END $$;

INSERT INTO "DecisaoDeduplicacao"("chaveDedup","candidatosAvaliados","nivelTriagem","decisao","justificativa","chaveIdempotencia")
VALUES ('nome:x','[]'::jsonb,'CONFIRMACAO','CRIOU_NOVA','Homonimo.','d3');
\echo '  ✅ CONFIRMACAO com justificativa aceita'
SQL

psql "$ADMIN" -tAc "DROP DATABASE IF EXISTS mdm_check;" >/dev/null
echo "✅ MIGRATIONS MDM — aplicam, reaplicam e as invariantes bloqueiam no banco."
