-- ESTADOS IMPOSSÍVEIS PASSAM A SER IMPOSSÍVEIS NO BANCO.
--
-- Invariante testada é invariante enquanto o teste roda. O que o banco recusa não
-- depende de ninguém lembrar de chamar a porta certa — e é a única defesa contra
-- escrita direta, script antigo e caminho que ninguém mapeou.
--
-- Cada índice abaixo corresponde a uma classe de falha que já apareceu neste sistema
-- ou que o fuzz produziu. Nenhum deles inventa regra nova: todos recusam o que o
-- domínio já dizia ser contraditório.
--
-- ADITIVA e VERIFICADA: em produção, no momento desta migration, zero linhas violam
-- qualquer uma delas (conferido antes de escrever o arquivo).

-- ── UMA TAREFA VIVA POR ETAPA ───────────────────────────────────────────────
-- A tarefa é a PROJEÇÃO atribuível da etapa. Duas vivas para a mesma etapa fazem
-- "quem é o responsável?" e "qual o prazo?" dependerem de qual linha for lida
-- primeiro. Concluída, cancelada e supersedida não disputam: são registro do que
-- houve, não trabalho pendente.
CREATE UNIQUE INDEX "Tarefa_uma_viva_por_etapa"
    ON "Tarefa"("workflowStepInstanceId")
    WHERE "workflowStepInstanceId" IS NOT NULL
      AND "statusTarefa" NOT IN ('CONCLUIDO_RECEBIDO', 'CONCLUIDO_NAO_POSSUI', 'CANCELADA', 'SUPERSEDIDA');

-- ── TENTATIVA CONCLUÍDA TEM DATA ────────────────────────────────────────────
-- "Concluído" sem o momento da conclusão é um estado sem dono — exatamente o que
-- restava quando reabrir fazia `completedAt = NULL`. O fuzz produziu isto por outro
-- caminho (tentativa nascendo já cumprida); aqui deixa de ser representável.
ALTER TABLE "StepExecution" ADD CONSTRAINT "StepExecution_concluida_tem_data"
    CHECK ("status" NOT IN ('CONCLUIDO', 'EXECUTADO') OR "completedAt" IS NOT NULL);

-- ── SUBSTITUÍDA APONTA PARA A SUCESSORA, E NÃO PARA SI ──────────────────────
-- A cadeia de tentativas é lida pelo ponteiro de substituição. Uma tentativa que
-- aponta para si mesma faz a leitura do histórico entrar em laço.
ALTER TABLE "StepExecution" ADD CONSTRAINT "StepExecution_substituicao_coerente"
    CHECK (("supersededAt" IS NULL AND "supersededPorId" IS NULL)
        OR ("supersededAt" IS NOT NULL AND "supersededPorId" IS DISTINCT FROM "id"));

-- ── SEQUÊNCIA DE TENTATIVA COMEÇA EM 1 ──────────────────────────────────────
ALTER TABLE "StepExecution" ADD CONSTRAINT "StepExecution_sequencia_positiva"
    CHECK ("sequencia" >= 1);

-- ── AÇÃO CADASTRADA TEM EFEITO ──────────────────────────────────────────────
-- Ação sem efeito é um botão que não faz nada. O catálogo é fechado e vive em
-- código; o que o banco garante é que a coluna nunca fique vazia.
ALTER TABLE "StepAction" ADD CONSTRAINT "StepAction_efeito_nao_vazio"
    CHECK (length(btrim("effectKey")) > 0);

-- ── CAMPO CADASTRADO TEM TIPO ───────────────────────────────────────────────
ALTER TABLE "StepField" ADD CONSTRAINT "StepField_tipo_nao_vazio"
    CHECK (length(btrim("tipo")) > 0);

-- ── DERIVAÇÃO DECLARA O TIPO ────────────────────────────────────────────────
-- Um documento derivado precisa dizer POR QUE nasceu. "Existe um pai" sem
-- "nova via" ou "retificação" é linhagem sem significado — e a pergunta que a
-- linhagem existe para responder é justamente essa.
--
-- (O vínculo com o sucessor não cabe num CHECK: Postgres não aceita subconsulta em
-- CHECK. Quem o garante é a FK de `derivadoDeId` mais a verificação DOC-L01.)
ALTER TABLE "Documento" ADD CONSTRAINT "Documento_derivacao_declara_tipo"
    CHECK ("derivadoDeId" IS NULL OR "derivacaoTipo" IS NOT NULL);
