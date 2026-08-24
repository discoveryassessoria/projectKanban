-- QUEM CONDUZ CADA FASE PASSA A SER DECLARADO, E NÃO ADIVINHADO.
--
-- ─── O QUE QUASE ACONTECEU ──────────────────────────────────────────────────
-- A primeira versão desta trava derivava o dono da fase da existência de cadastro
-- operacional publicado: "se os passos têm ação e campo, o motor assumiu". Parece
-- razoável e está errado.
--
-- Medido em produção, 24/08/2026:
--
--   analise_documental → 5/5 passos com cadastro publicado (v3)
--                        3 instâncias, 15 tentativas
--                        ZERO ações canônicas executadas
--                        `AnaliseDocumental` (tabela da tela anterior): 1 linha, concluída
--
-- Ou seja: o cadastro existia há tempo, e a operação nunca migrou — quem conduz a
-- Análise hoje é a tela anterior. Aplicar a derivação teria feito `analise/concluir`
-- recusar, e a Análise pararia de funcionar em produção.
--
-- ─── A CORREÇÃO ────────────────────────────────────────────────────────────
-- Trocar de motor é DECISÃO de quem administra, tomada quando a operação estiver
-- pronta — não consequência de alguém ter preenchido um cadastro. A coluna nasce
-- `false` para todas: nada muda para ninguém até alguém dizer que mudou.
--
-- A ÚNICA fase que nasce `true` é a Retificação, e por prova, não por conveniência:
-- os seis passos foram configurados e publicados hoje (v2, 6/6 com cadastro), a
-- matriz de capacidades da tela anterior foi levantada campo a campo, e cada uma tem
-- destino canônico com tela onde é operada.

ALTER TABLE "CatalogoFase"
  ADD COLUMN IF NOT EXISTS "conduzidaPeloWorkflowInterno" BOOLEAN NOT NULL DEFAULT false;

UPDATE "CatalogoFase"
   SET "conduzidaPeloWorkflowInterno" = true
 WHERE "phaseKey" = 'retificacao_registros';
