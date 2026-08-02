-- F4 — Estado de negócio do Custo (ObrigacaoEconomica.estadoCusto). Aditivo/reversível:
-- coluna nullable, sem default, sem backfill. Ortogonal ao status do contrato; null p/ receita.
ALTER TABLE "ObrigacaoEconomica" ADD COLUMN "estadoCusto" VARCHAR(24);
