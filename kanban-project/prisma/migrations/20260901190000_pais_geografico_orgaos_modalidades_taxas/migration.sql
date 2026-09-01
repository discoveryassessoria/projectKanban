-- ============================================================================
-- ÓRGÃOS, MODALIDADES E TAXAS — as últimas identidades textuais de país
-- ----------------------------------------------------------------------------
-- 1. O CADASTRO DE PAÍSES DEIXA DE SER "O QUE VENDEMOS"
--
-- Os 262 órgãos citam 10 países, todos inequívocos. Seis não estavam no
-- cadastro porque ele só continha as nacionalidades ofertadas — e é justamente
-- essa confusão que a rodada anterior desfez. Entram como PAÍSES; nenhum deles
-- vira cidadania, porque oferta é ter Tipo de Processo ativo, e nenhum tem.
--
--   Itália 160 · Brasil 60 · Espanha 12 · Estados Unidos 11 · Portugal 7
--   Alemanha 3 · Argentina 3 · Paraguai 3 · França 2 · Reino Unido 1 · nulos 0
--
-- Nenhum valor ambíguo ("Exterior", "Internacional", "Outro") apareceu — se
-- tivesse aparecido, eu pararia nele em vez de escolher um país.
--
-- 2. ORGAOPROTOCOLO.country → paisId
--    O país do ÓRGÃO é geográfico e não tem relação com a nacionalidade do
--    processo: o Consolato d'Italia em Miami fica nos Estados Unidos.
--
-- 3. MODALIDADEPAIS.countryKey → paisId
--    A junction continua N:N; muda a chave, não a natureza. 8 linhas, 4 chaves,
--    correspondência exata.
--
-- 4. TAXAPAGAMENTO.paises (array textual) É REMOVIDA
--    Todas as 14 linhas têm array VAZIO — o campo nunca foi usado, e a relação
--    `TaxaPagamentoPais` já existia para o mesmo fim. Não há dado a migrar: se
--    houvesse, viraria linha na junction, nunca array de IDs em JSON.
-- ============================================================================

-- ── 1. Países que faltavam no cadastro geográfico ───────────────────────────
INSERT INTO "CatalogoPais" ("countryKey","countryLabel","nationalityKey","nationalityLabel","flag","defaultCurrency","ativo","criadoEm","atualizadoEm")
VALUES
  ('brasil','Brasil','brasileira','Brasileira','🇧🇷','BRL',true,NOW(),NOW()),
  ('estados_unidos','Estados Unidos','estadunidense','Estadunidense','🇺🇸','USD',true,NOW(),NOW()),
  ('argentina','Argentina','argentina','Argentina','🇦🇷','ARS',true,NOW(),NOW()),
  ('franca','França','francesa','Francesa','🇫🇷','EUR',true,NOW(),NOW()),
  ('reino_unido','Reino Unido','britanica','Britânica','🇬🇧','GBP',true,NOW(),NOW())
ON CONFLICT ("countryKey") DO NOTHING;

-- ── 2. Órgãos ──────────────────────────────────────────────────────────────
ALTER TABLE "OrgaoProtocolo" ADD COLUMN IF NOT EXISTS "paisId" INTEGER;

-- Resolução por RÓTULO porque é o que a coluna guarda; os aliases estão
-- explícitos aqui e não escondidos numa função de normalização.
UPDATE "OrgaoProtocolo" o SET "paisId" = c.id
  FROM "CatalogoPais" c
 WHERE o."paisId" IS NULL AND o.country IS NOT NULL
   AND lower(o.country) = lower(c."countryLabel");

CREATE INDEX IF NOT EXISTS "OrgaoProtocolo_paisId_idx" ON "OrgaoProtocolo"("paisId");
DO $$ BEGIN
  ALTER TABLE "OrgaoProtocolo" ADD CONSTRAINT "OrgaoProtocolo_paisId_fkey"
    FOREIGN KEY ("paisId") REFERENCES "CatalogoPais"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── 3. Modalidades ─────────────────────────────────────────────────────────
ALTER TABLE "ModalidadePais" ADD COLUMN IF NOT EXISTS "paisId" INTEGER;
UPDATE "ModalidadePais" m SET "paisId" = c.id
  FROM "CatalogoPais" c
 WHERE m."paisId" IS NULL AND lower(m."countryKey") = lower(c."countryKey");

CREATE INDEX IF NOT EXISTS "ModalidadePais_paisId_idx" ON "ModalidadePais"("paisId");
DO $$ BEGIN
  ALTER TABLE "ModalidadePais" ADD CONSTRAINT "ModalidadePais_paisId_fkey"
    FOREIGN KEY ("paisId") REFERENCES "CatalogoPais"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── 4. O array textual de países das taxas ─────────────────────────────────
ALTER TABLE "TaxaPagamento" DROP COLUMN IF EXISTS "paises";
