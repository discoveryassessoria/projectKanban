-- CADASTRO CANÔNICO DE FASES — o que faltava para uma fase nascer sem código.
--
-- `CatalogoFase` já era o cadastro mestre, com tela e RBAC, e o Workflow Macro já
-- lia dele. Faltavam duas coisas para uma fase criada ali ser de fato utilizável:
--
--   ESCOPO — sobre o que a fase opera (processo, pessoa, necessidade, documento).
--            Era o único dado que existia SÓ no catálogo em código, e é o que a
--            materialização usa para decidir sobre quantas entidades multiplicar os
--            passos. Sem ele, toda fase nova viraria silenciosamente PROCESSO.
--   DESCRIÇÃO — o campo que o cadastro pedia e não tinha.
--
-- ADITIVO e REVERSÍVEL: duas colunas novas, nulas, e um backfill das dez fases já
-- existentes a partir do catálogo oficial. Nenhuma linha é apagada, nenhum processo
-- é tocado, nenhuma chave muda.
ALTER TABLE "CatalogoFase" ADD COLUMN IF NOT EXISTS "descricao" TEXT;
ALTER TABLE "CatalogoFase" ADD COLUMN IF NOT EXISTS "escopo" "EscopoExecucao";

-- BACKFILL das fases canônicas, com o escopo que o catálogo em código declara.
-- Só por phaseKey exata: chave legada (`retificacao`, `traducao`) fica sem escopo de
-- propósito — ela não é uma fase nova, é uma duplicata da canônica, e o cadastro
-- passa a dizer isso em vez de deixá-la parecer utilizável.
UPDATE "CatalogoFase" SET "escopo" = 'NECESSIDADE' WHERE "phaseKey" = 'genealogia' AND "escopo" IS NULL;
UPDATE "CatalogoFase" SET "escopo" = 'DOCUMENTO'   WHERE "phaseKey" = 'emissao_documental' AND "escopo" IS NULL;
UPDATE "CatalogoFase" SET "escopo" = 'PROCESSO'    WHERE "phaseKey" IN (
  'analise_documental', 'retificacao_registros', 'emissao_documental_retificada',
  'traducao_juramentada', 'apostilamento', 'aguardando_protocolo', 'protocolado', 'finalizado'
) AND "escopo" IS NULL;
