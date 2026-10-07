-- LOCAL DO ÓBITO EM COLUNAS PRÓPRIAS (07/10/2026).
-- Hoje o local do óbito mora no texto único "Pessoa"."local_emigracao", que TAMBÉM serve para emigração. Aqui nascem cidade / estado / país do óbito.
-- SÓ ADITIVA: três colunas anuláveis. NADA é apagado ou alterado — nem "local_emigracao". O preenchimento (backfill) dos casos que dá para ler com segurança é
-- um passo à parte, só em colunas novas, com lista dos que ficam vazios.
ALTER TABLE "Pessoa" ADD COLUMN IF NOT EXISTS "local_obito"  VARCHAR(100);
ALTER TABLE "Pessoa" ADD COLUMN IF NOT EXISTS "estado_obito" VARCHAR(50);
ALTER TABLE "Pessoa" ADD COLUMN IF NOT EXISTS "pais_obito"   VARCHAR(50);
