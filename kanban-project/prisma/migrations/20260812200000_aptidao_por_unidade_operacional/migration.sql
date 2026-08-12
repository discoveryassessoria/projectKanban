-- APTIDÃO DEIXA DE SER "FASE DO WORKFLOW MACRO" E PASSA A SER UNIDADE DE TRABALHO.
--
-- A tabela nasceu apontando para `faseKey`, e o primeiro uso real expôs o erro:
-- o cadastro oferecia "Finalizado", "Aguardando protocolo" e "Protocolado" como
-- se fossem competências humanas. Fase diz ONDE O PROCESSO ESTÁ; aptidão diz QUE
-- TRABALHO A PESSOA SABE FAZER. São eixos diferentes e não se colapsam.
--
-- A nova dimensão é `PerfilOperacionalDocumento` — que o Cadastro Mestre já
-- define como "qual workflow processa este documento". Nenhum catálogo novo foi
-- criado: um catálogo paralelo seria uma segunda fonte mestre.
--
-- ─── OS DADOS ANTIGOS NÃO SÃO CONVERTIDOS ───────────────────────────────────
-- Não existe equivalência honesta entre uma fase e uma unidade de trabalho:
-- "apto para Emissão documental" não significa "apto para Emissão de Certidão",
-- e "apto para Finalizado" não significa coisa nenhuma. Converter por semelhança
-- de nome inventaria competência que ninguém declarou — e competência inventada
-- manda trabalho real para a pessoa errada.
--
-- As linhas são REMOVIDAS, e o que existia fica registrado na auditoria abaixo,
-- nominalmente, para que a decisão continue explicável depois.

-- 1) O RASTRO ANTES DA REMOÇÃO — uma entrada por funcionário afetado.
INSERT INTO "LogAuditoria" ("acao", "entidade", "entidadeId", "descricao", "detalhes", "usuarioId", "criadoEm")
SELECT
  'EXCLUIR',
  'CapacidadeOperacional',
  a."usuarioId",
  'Aptidões removidas na correção de modelagem: estavam cadastradas como FASES do workflow macro (' ||
    string_agg(a."faseKey", ', ' ORDER BY a."faseKey") ||
    '), e fase não é competência. Nenhuma foi convertida em unidade de trabalho — converter por semelhança de nome inventaria competência que ninguém declarou. Recadastre as aptidões reais em Gerenciamento › Usuários e Acessos › Capacidade Operacional.',
  jsonb_build_object(
    'motivo', 'correcao_de_modelagem',
    'dimensaoAntiga', 'faseMacro',
    'dimensaoNova', 'perfilOperacional',
    'removidas', jsonb_agg(a."faseKey" ORDER BY a."faseKey")
  ),
  NULL,
  NOW()
FROM "AptidaoOperacional" a
GROUP BY a."usuarioId";

-- 2) A remoção. Só as aptidões — nada mais é tocado.
DELETE FROM "AptidaoOperacional";

-- 3) A troca de dimensão.
DROP INDEX IF EXISTS "AptidaoOperacional_faseKey_idx";
DROP INDEX IF EXISTS "AptidaoOperacional_usuarioId_faseKey_key";
ALTER TABLE "AptidaoOperacional" DROP COLUMN "faseKey";
ALTER TABLE "AptidaoOperacional" ADD COLUMN "perfilOperacionalId" INTEGER NOT NULL;

CREATE UNIQUE INDEX "AptidaoOperacional_usuarioId_perfilOperacionalId_key"
  ON "AptidaoOperacional"("usuarioId", "perfilOperacionalId");
CREATE INDEX "AptidaoOperacional_perfilOperacionalId_idx"
  ON "AptidaoOperacional"("perfilOperacionalId");
ALTER TABLE "AptidaoOperacional" ADD CONSTRAINT "AptidaoOperacional_perfilOperacionalId_fkey"
  FOREIGN KEY ("perfilOperacionalId") REFERENCES "PerfilOperacionalDocumento"("id") ON DELETE CASCADE ON UPDATE CASCADE;
