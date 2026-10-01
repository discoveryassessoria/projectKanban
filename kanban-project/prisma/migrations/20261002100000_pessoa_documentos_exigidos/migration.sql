-- PESSOA.documentosExigidos — quais certidões (Nascimento / Casamento / Óbito) a equipe quer
-- para esta pessoa quando ela está FORA da linhagem e "precisa de documentação".
--
-- É um FILTRO SUBTRATIVO sobre a regra automática da árvore: exigido = regra aplicável ∩ marcado.
-- Nunca cria exigência que a árvore não pede. Lista fechada de três códigos conferida na porta da API
-- (mesmo padrão de ContatoTerceiro.canal), não no banco.
--
-- ADITIVA, IDEMPOTENTE, NULLABLE, SEM BACKFILL. NULL = regra automática, exatamente como é hoje:
-- toda pessoa existente continua se comportando como antes.

ALTER TABLE "Pessoa" ADD COLUMN IF NOT EXISTS "documentosExigidos" JSONB;
