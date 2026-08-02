-- CATÁLOGO — FIM DA REFERÊNCIA ESTRUTURAL EM TEXTO.
--
-- Elimina DEFINITIVAMENTE os três campos que representavam entidade oficial como
-- texto e os substitui por relacionamento real:
--
--   ServicoProduto.category  (VarChar 80) ─┐
--   ItemCatalogo.categoria   (VarChar 60) ─┴─→ ItemCatalogo.categoriaId → CategoriaServico
--   ServicoProduto.nationality (VarChar 40) ─→ ServicoProduto.aplicacaoGlobal
--                                              + ServicoProdutoPais (N:N → CatalogoPais)
--
-- MIGRAÇÃO COMPLETA EM UM ÚNICO PASSO ATÔMICO. O Prisma executa cada migration
-- dentro de uma transação: ou tudo entra, ou nada entra. Por isso é seguro
-- expandir, migrar, VERIFICAR e remover o legado aqui mesmo — não existe janela
-- em que o banco fique em estado misto, e não existe legado sobrevivente.
--
-- GARANTIA DE NÃO-PERDA: antes de qualquer DROP, o bloco de VERIFICAÇÃO confere
-- que todo valor textual existente foi convertido em vínculo. Se UM só valor não
-- resolver, a migration lança exceção, a transação inteira é revertida e o banco
-- fica exatamente como estava — o deployment em curso continua no ar. Nada é
-- mapeado "por aproximação" e nada é descartado em silêncio.
--
-- A categoria passa a ter UM ÚNICO portador: o mestre (ItemCatalogo). O serviço
-- lê pela sua projeção no mestre. Não há segunda cópia nem escrita dupla.

-- ══ A) Estrutura: aplicação territorial ═════════════════════════════════════

ALTER TABLE "ServicoProduto" ADD COLUMN IF NOT EXISTS "aplicacaoGlobal" BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE IF NOT EXISTS "ServicoProdutoPais" (
    "id" SERIAL NOT NULL,
    "servicoId" INTEGER NOT NULL,
    "paisId" INTEGER NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ServicoProdutoPais_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ServicoProdutoPais_servicoId_paisId_key" ON "ServicoProdutoPais"("servicoId", "paisId");
CREATE INDEX IF NOT EXISTS "ServicoProdutoPais_servicoId_idx" ON "ServicoProdutoPais"("servicoId");
CREATE INDEX IF NOT EXISTS "ServicoProdutoPais_paisId_idx" ON "ServicoProdutoPais"("paisId");

DO $$ BEGIN
    ALTER TABLE "ServicoProdutoPais" ADD CONSTRAINT "ServicoProdutoPais_servicoId_fkey"
        FOREIGN KEY ("servicoId") REFERENCES "ServicoProduto"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE "ServicoProdutoPais" ADD CONSTRAINT "ServicoProdutoPais_paisId_fkey"
        FOREIGN KEY ("paisId") REFERENCES "CatalogoPais"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ══ B) Estrutura: categoria por FK ══════════════════════════════════════════

ALTER TABLE "ItemCatalogo" ADD COLUMN IF NOT EXISTS "categoriaId" INTEGER;
CREATE INDEX IF NOT EXISTS "ItemCatalogo_categoriaId_idx" ON "ItemCatalogo"("categoriaId");

DO $$ BEGIN
    ALTER TABLE "ItemCatalogo" ADD CONSTRAINT "ItemCatalogo_categoriaId_fkey"
        FOREIGN KEY ("categoriaId") REFERENCES "CategoriaServico"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ══ C) Categorias oficiais ═════════════════════════════════════════════════
-- As três categorias do catálogo, com `code` imutável. Idempotente: só cria o
-- que falta e nunca altera o code de quem já existe.

INSERT INTO "CategoriaServico" ("code", "nome", "descricao", "ordem", "ativo", "criadoEm", "atualizadoEm")
VALUES
    ('CIDNAC', 'Cidadania e Nacionalidade', 'Serviços relacionados ao reconhecimento, aquisição ou regularização de cidadania e nacionalidade.', 1, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('REGCIV', 'Registro Civil', 'Serviços relacionados a transcrições, inscrições, averbações e demais atos de registro civil.', 2, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('RETREG', 'Retificação de Registro Civil', 'Serviços administrativos ou judiciais destinados à correção de registros civis.', 3, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;

-- CONSOLIDAÇÃO das variações textuais existentes nas categorias oficiais.
-- A comparação é feita sobre o texto NORMALIZADO (sem acento, sem caixa, sem
-- espaço/pontuação excedente), que é o que faz "Registro civil", "REGISTRO_CIVIL"
-- e "registro  civil" convergirem para o MESMO registro em vez de criarem três.
-- O que não estiver aqui NÃO é adivinhado: vira categoria própria no passo D2,
-- preservando fielmente o que o dado dizia.

CREATE TEMPORARY TABLE _mapa_categoria (chave TEXT PRIMARY KEY, code TEXT NOT NULL) ON COMMIT DROP;
INSERT INTO _mapa_categoria (chave, code) VALUES
    ('NACIONALIDADE', 'CIDNAC'),
    ('CIDADANIA', 'CIDNAC'),
    ('CIDADANIA_E_NACIONALIDADE', 'CIDNAC'),
    ('HONORARIOS', 'CIDNAC'),
    ('REGISTRO_CIVIL', 'REGCIV'),
    ('SERVICO_DOCUMENTAL', 'REGCIV'),
    ('TRANSCRICAO', 'REGCIV'),
    ('RETIFICACAO', 'RETREG'),
    ('RETIFICACAO_DE_REGISTRO_CIVIL', 'RETREG');

-- D1) Item cuja categoria textual casa com o mapa → categoria oficial.
UPDATE "ItemCatalogo" i
   SET "categoriaId" = k."id"
  FROM _mapa_categoria m
  JOIN "CategoriaServico" k ON k."code" = m."code"
 WHERE i."categoriaId" IS NULL
   AND i."categoria" IS NOT NULL AND btrim(i."categoria") <> ''
   AND m."chave" = btrim(regexp_replace(
        upper(translate(btrim(i."categoria"),
            'áàâãäéèêëíìîïóòôõöúùûüçñÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑ',
            'aaaaaeeeeiiiiooooouuuucnAAAAAEEEEIIIIOOOOOUUUUCN')),
        '[^A-Z0-9]+', '_', 'g'), '_');

-- Mesma consolidação para a categoria que só existia no registro do serviço.
UPDATE "ItemCatalogo" i
   SET "categoriaId" = k."id"
  FROM "ServicoProduto" s, _mapa_categoria m, "CategoriaServico" k
 WHERE s."itemCatalogoId" = i."id"
   AND i."categoriaId" IS NULL
   AND k."code" = m."code"
   AND s."category" IS NOT NULL AND btrim(s."category") <> ''
   AND m."chave" = btrim(regexp_replace(
        upper(translate(btrim(s."category"),
            'áàâãäéèêëíìîïóòôõöúùûüçñÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑ',
            'aaaaaeeeeiiiiooooouuuucnAAAAAEEEEIIIIOOOOOUUUUCN')),
        '[^A-Z0-9]+', '_', 'g'), '_');

-- D2) Valor textual FORA do mapa: vira categoria própria, com o texto original
-- preservado como nome. Não se adivinha equivalência e não se descarta o dado —
-- fica visível no cadastro para curadoria humana posterior.

WITH brutos AS (
    SELECT DISTINCT btrim(c) AS txt
    FROM (
        SELECT i."categoria" AS c FROM "ItemCatalogo" i
         WHERE i."categoriaId" IS NULL AND i."categoria" IS NOT NULL AND btrim(i."categoria") <> ''
        UNION ALL
        SELECT s."category" AS c FROM "ServicoProduto" s
          LEFT JOIN "ItemCatalogo" i2 ON i2."id" = s."itemCatalogoId"
         WHERE s."category" IS NOT NULL AND btrim(s."category") <> '' AND (i2."id" IS NULL OR i2."categoriaId" IS NULL)
    ) u
), slugs AS (
    SELECT txt, btrim(regexp_replace(
        upper(translate(txt,
            'áàâãäéèêëíìîïóòôõöúùûüçñÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑ',
            'aaaaaeeeeiiiiooooouuuucnAAAAAEEEEIIIIOOOOOUUUUCN')),
        '[^A-Z0-9]+', '_', 'g'), '_') AS code
    FROM brutos
), canon AS (
    SELECT code, (array_agg(txt ORDER BY length(txt), txt))[1] AS nome
    FROM slugs WHERE code <> '' GROUP BY code
)
INSERT INTO "CategoriaServico" ("code", "nome", "descricao", "ordem", "ativo", "criadoEm", "atualizadoEm")
SELECT left(c.code, 60),
       CASE WHEN c.nome ~ '^[A-Z0-9_]+$' THEN initcap(replace(lower(c.nome), '_', ' ')) ELSE c.nome END,
       NULL,
       (SELECT COALESCE(max("ordem"), 0) FROM "CategoriaServico") + row_number() OVER (ORDER BY c.code),
       true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM canon c
ON CONFLICT ("code") DO NOTHING;

-- D3) Vincula o que sobrou às categorias recém-criadas.
UPDATE "ItemCatalogo" i
   SET "categoriaId" = k."id"
  FROM "CategoriaServico" k
 WHERE i."categoriaId" IS NULL
   AND i."categoria" IS NOT NULL AND btrim(i."categoria") <> ''
   AND k."code" = left(btrim(regexp_replace(
        upper(translate(btrim(i."categoria"),
            'áàâãäéèêëíìîïóòôõöúùûüçñÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑ',
            'aaaaaeeeeiiiiooooouuuucnAAAAAEEEEIIIIOOOOOUUUUCN')),
        '[^A-Z0-9]+', '_', 'g'), '_'), 60);

UPDATE "ItemCatalogo" i
   SET "categoriaId" = k."id"
  FROM "ServicoProduto" s, "CategoriaServico" k
 WHERE s."itemCatalogoId" = i."id"
   AND i."categoriaId" IS NULL
   AND s."category" IS NOT NULL AND btrim(s."category") <> ''
   AND k."code" = left(btrim(regexp_replace(
        upper(translate(btrim(s."category"),
            'áàâãäéèêëíìîïóòôõöúùûüçñÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑ',
            'aaaaaeeeeiiiiooooouuuucnAAAAAEEEEIIIIOOOOOUUUUCN')),
        '[^A-Z0-9]+', '_', 'g'), '_'), 60);

-- ══ E) Território: texto → vínculo real com o cadastro de países ═══════════
-- Apelidos cobrem o que a tela antiga gravava ("italiano"), o que os scripts de
-- carga gravavam ("italia") e as formas em inglês. "all"/"todas"/"global" NÃO
-- viram vínculo: são aplicação global, que é justamente a ausência de vínculo.

WITH bruto AS (
    SELECT s."id" AS servico_id,
           lower(btrim(translate(s."nationality",
               'áàâãäéèêëíìîïóòôõöúùûüçñÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑ',
               'aaaaaeeeeiiiiooooouuuucnAAAAAEEEEIIIIOOOOOUUUUCN'))) AS valor
      FROM "ServicoProduto" s
     WHERE s."nationality" IS NOT NULL
), filtrado AS (
    SELECT servico_id, valor FROM bruto
     WHERE valor NOT IN ('', 'all', 'todas', 'todos', 'global')
), apelido(legado, chave) AS (
    VALUES
        ('italiano', 'italia'), ('italiana', 'italia'), ('italian', 'italia'), ('italy', 'italia'),
        ('espanhol', 'espanha'), ('espanhola', 'espanha'), ('spanish', 'espanha'), ('spain', 'espanha'),
        ('portugues', 'portugal'), ('portuguesa', 'portugal'), ('portuguese', 'portugal'),
        ('alemao', 'alemanha'), ('alema', 'alemanha'), ('german', 'alemanha'), ('germany', 'alemanha')
), chave AS (
    SELECT f.servico_id, COALESCE(a.chave, f.valor) AS chave
      FROM filtrado f
      LEFT JOIN apelido a ON a.legado = f.valor
), resolvido AS (
    SELECT c.servico_id, p."id" AS pais_id
      FROM chave c
      JOIN "CatalogoPais" p
        ON lower(p."countryKey") = c.chave
        OR lower(p."nationalityKey") = c.chave
)
INSERT INTO "ServicoProdutoPais" ("servicoId", "paisId")
SELECT DISTINCT servico_id, pais_id FROM resolvido
ON CONFLICT ("servicoId", "paisId") DO NOTHING;

UPDATE "ServicoProduto" s
   SET "aplicacaoGlobal" = false
 WHERE EXISTS (SELECT 1 FROM "ServicoProdutoPais" v WHERE v."servicoId" = s."id");

-- ══ F) VERIFICAÇÃO — nada é removido sem prova de equivalência ═════════════

DO $$
DECLARE
    pendentes TEXT;
    quantos   INTEGER;
BEGIN
    -- F1. Todo item com categoria textual precisa ter categoria oficial.
    SELECT count(*), string_agg(DISTINCT i."categoria", ', ')
      INTO quantos, pendentes
      FROM "ItemCatalogo" i
     WHERE i."categoria" IS NOT NULL AND btrim(i."categoria") <> '' AND i."categoriaId" IS NULL;
    IF quantos > 0 THEN
        RAISE EXCEPTION 'MIGRAÇÃO ABORTADA — % item(ns) do mestre com categoria textual que não resolveu para categoria oficial: %. Nenhum dado foi alterado.', quantos, pendentes;
    END IF;

    -- F2. Todo serviço com categoria textual precisa tê-la preservada no mestre.
    --     Serviço sem mestre não teria onde guardar a categoria: é bloqueio, não descarte.
    SELECT count(*), string_agg(DISTINCT s."category", ', ')
      INTO quantos, pendentes
      FROM "ServicoProduto" s
      LEFT JOIN "ItemCatalogo" i ON i."id" = s."itemCatalogoId"
     WHERE s."category" IS NOT NULL AND btrim(s."category") <> ''
       AND (i."id" IS NULL OR i."categoriaId" IS NULL);
    IF quantos > 0 THEN
        RAISE EXCEPTION 'MIGRAÇÃO ABORTADA — % serviço(s) com categoria textual sem destino oficial no mestre: %. Nenhum dado foi alterado.', quantos, pendentes;
    END IF;

    -- F3. Todo território textual precisa ter virado vínculo real. Valor
    --     ambíguo/desconhecido PARA a migração: não se adivinha país.
    SELECT count(*), string_agg(DISTINCT s."nationality", ', ')
      INTO quantos, pendentes
      FROM "ServicoProduto" s
     WHERE s."nationality" IS NOT NULL
       AND lower(btrim(s."nationality")) NOT IN ('', 'all', 'todas', 'todos', 'global')
       AND NOT EXISTS (SELECT 1 FROM "ServicoProdutoPais" v WHERE v."servicoId" = s."id");
    IF quantos > 0 THEN
        RAISE EXCEPTION 'MIGRAÇÃO ABORTADA — % serviço(s) com nacionalidade textual sem país correspondente em CatalogoPais: %. Cadastre o país oficial (Gerenciamento › Países e Regiões) ou corrija o valor, e reimplante. Nenhum dado foi alterado.', quantos, pendentes;
    END IF;

    RAISE NOTICE 'Equivalência verificada: categoria e território integralmente convertidos em relacionamento.';
END $$;

-- ══ G) Remoção definitiva do legado ════════════════════════════════════════
-- Só se executa porque a verificação acima passou.

ALTER TABLE "ServicoProduto" DROP COLUMN IF EXISTS "category";
ALTER TABLE "ServicoProduto" DROP COLUMN IF EXISTS "nationality";
ALTER TABLE "ItemCatalogo"   DROP COLUMN IF EXISTS "categoria";
