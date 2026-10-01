-- TORRE NOVA (M5) — "BOLA COM": qual rótulo a categoria da organização produz.
--
-- Cartório, Tradutor, Juízo ou Consulado — DADO de cadastro (Gerenciamento › Categorias de Organização),
-- nunca lista no código. Nullable: categoria que não diz nada cai em "Cartório". Vocabulário fechado
-- conferido na porta da API, não no banco (mesmo padrão de ContatoTerceiro.canal).
--
-- ADITIVA e IDEMPOTENTE.

ALTER TABLE "CategoriaOrganizacao" ADD COLUMN IF NOT EXISTS "rotuloBola" VARCHAR(30);
