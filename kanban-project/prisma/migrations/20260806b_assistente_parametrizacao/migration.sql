-- ASSISTENTE DE PARAMETRIZAÇÃO — progresso, e só progresso.
--
-- POR QUE UMA TABELA, E POR QUE TÃO PEQUENA
-- -----------------------------------------
-- O assistente conduz o administrador por catorze etapas, mas não é dono de
-- nenhum dado que ele coleta: a Matriz vive em "MatrizDocumental", o preço em
-- "TabelaValor", o fornecedor em "Fornecedor", o componente econômico em
-- "PhaseEconomicRule". Guardar cópia disso aqui criaria a segunda fonte que a
-- baseline proíbe — e a divergência apareceria no primeiro cadastro feito pela
-- tela administrativa, fora do assistente.
--
-- O que sobra para guardar é o que não pertence a nenhuma entidade de domínio:
-- em que escopo o administrador está trabalhando, em que etapa parou, quem
-- estava mexendo e quando publicou. Um marcador de lugar, não um formulário
-- salvo.
--
-- `etapasConcluidas` guarda CHAVES de etapa (["escopo","matriz",...]), nunca o
-- conteúdo preenchido nelas.
--
-- ADITIVA e IDEMPOTENTE: cria uma tabela nova e nada mais. Nenhuma linha
-- existente é lida, alterada ou removida.
--
-- ROLLBACK: DROP TABLE "AssistenteParametrizacaoProgresso";

CREATE TABLE IF NOT EXISTS "AssistenteParametrizacaoProgresso" (
    "id" SERIAL NOT NULL,
    "tipoProcessoId" INTEGER NOT NULL,
    "phaseKey" VARCHAR(60),
    "etapaAtual" VARCHAR(40) NOT NULL,
    "etapasConcluidas" JSONB,
    "usuarioId" INTEGER,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,
    "publicadoEm" TIMESTAMP(3),
    "publicadoPor" INTEGER,
    CONSTRAINT "AssistenteParametrizacaoProgresso_pkey" PRIMARY KEY ("id")
);

-- Um progresso por escopo: reabrir o assistente continua de onde parou, em vez
-- de abrir uma segunda linha e passar a haver dois "onde parei".
CREATE UNIQUE INDEX IF NOT EXISTS "AssistenteParametrizacaoProgresso_tipoProcessoId_phaseKey_key"
  ON "AssistenteParametrizacaoProgresso"("tipoProcessoId", "phaseKey");
CREATE INDEX IF NOT EXISTS "AssistenteParametrizacaoProgresso_tipoProcessoId_idx"
  ON "AssistenteParametrizacaoProgresso"("tipoProcessoId");
