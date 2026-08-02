-- F0 — Exclusão lógica de Custo (soft-delete) na obrigação econômica.
-- Aditivo e reversível: coluna nullable, sem default, sem backfill. Ledger preservado;
-- as consultas operacionais passam a filtrar arquivadaEm IS NULL.
ALTER TABLE "ObrigacaoEconomica" ADD COLUMN "arquivadaEm" TIMESTAMP(3);
