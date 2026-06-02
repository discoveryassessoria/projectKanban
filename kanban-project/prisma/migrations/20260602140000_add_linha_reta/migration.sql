-- Migration: add_linha_reta
-- Adiciona o campo linhaReta na tabela Pessoa.
--
-- linhaReta = a pessoa é da linha reta / obrigatória para a cidadania.
-- Só pessoas com linhaReta = true contam para o gate de avanço de fase
-- (o "carro" só anda quando todos os obrigatórios concluíram a etapa).
-- Pessoas com linhaReta = false ficam na árvore mas NÃO seguram o avanço.
--
-- ADITIVA E SEGURA: só adiciona uma coluna com default true.
-- Não altera nem remove nada. Todas as 1.751 pessoas existentes nascem
-- como true (comportamento conservador = espera todo mundo, como hoje),
-- e você marca como false caso a caso depois.

ALTER TABLE "Pessoa" ADD COLUMN "linhaReta" BOOLEAN NOT NULL DEFAULT true;