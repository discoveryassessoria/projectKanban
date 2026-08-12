-- VÍNCULO DOCUMENTAL DO CUSTO — o financeiro volta a saber DE QUEM e DE QUÊ.
--
-- POR QUE
-- -------
-- O model `Custo` legado carregava personId / documentoId / tipoServicoId /
-- phaseKey / phaseCycle, e era exatamente por esses campos que a Planilha
-- Documental montava a grade (uma LINHA por documento, uma COLUNA por serviço) e
-- somava total por documento, por pessoa e por processo.
--
-- Em 28/07/2026 (commit 4fca632e, cherry-pick ecccbb34, "custos F3.5: motor de
-- fase V3-native") o motor deixou de escrever no `Custo` legado e passou a criar
-- direto `ObrigacaoEconomica` + Ledger. A migração preservou dinheiro, Ledger e
-- idempotência — mas a `ObrigacaoEconomica` não tinha onde guardar o vínculo, que
-- passou a viver como TEXTO em `observacoes` ("· doc#2080"). O custo continuou
-- existindo; o que se perdeu foi a capacidade de PROJETAR a planilha a partir
-- dele.
--
-- O QUE ESTA MIGRATION FAZ
-- ------------------------
--   • devolve o vínculo à obrigação, por ID (pessoa, documento, serviço, fase,
--     ciclo, configuração financeira);
--   • declara COMO o lançamento nasceu (automático documental / backfill /
--     manual) e QUAL evento o causou, para separar despesa extraordinária de
--     custo derivado da cadeia documental sem adivinhação;
--   • congela o preço no instante do lançamento (regra, unitário, quantidade,
--     modo de cálculo, contexto, data) — mudar a Tabela de Preços não reescreve
--     história;
--   • garante idempotência no BANCO (chaveIdempotencia @unique): localizar o
--     mesmo registro duas vezes não pode gerar dois custos.
--
-- O QUE ELA NÃO FAZ
-- -----------------
-- Não cria segunda fonte de verdade: o Ledger continua sendo a única verdade do
-- movimento e do saldo. Estas colunas dizem a que FATO OPERACIONAL a obrigação
-- pertence — é o mesmo papel que os campos homônimos já cumprem na Receita.
-- Não classifica retroativamente nada: `origemLancamento` nasce NULL nas linhas
-- existentes, e a reconciliação apenas RELATA os não classificados.
--
-- ADITIVA e IDEMPOTENTE: só adiciona coluna e índice novos. Nenhuma linha é
-- lida, alterada ou removida; nenhuma coluna é dropada; todas as colunas novas
-- nascem NULL, então nenhum comportamento atual muda.
--
-- ROLLBACK (sem perda de dado pré-existente — tudo aqui é novo):
--   ALTER TABLE "ObrigacaoEconomica"
--     DROP COLUMN "personId", DROP COLUMN "documentoId", DROP COLUMN "tipoServicoId",
--     DROP COLUMN "phaseKey", DROP COLUMN "phaseCycle", DROP COLUMN "configFinanceiraId",
--     DROP COLUMN "origemLancamento", DROP COLUMN "eventoOrigemTipo", DROP COLUMN "eventoOrigemId",
--     DROP COLUMN "pricingRuleId", DROP COLUMN "valorUnitario", DROP COLUMN "quantidade",
--     DROP COLUMN "modoCalculoAplicado", DROP COLUMN "naturezaPreco",
--     DROP COLUMN "contextoAplicado", DROP COLUMN "dataReferencia",
--     DROP COLUMN "chaveIdempotencia";

-- ── Vínculo operacional (por ID, nunca por texto) ───────────────────────────
ALTER TABLE "ObrigacaoEconomica" ADD COLUMN IF NOT EXISTS "personId" INTEGER;
ALTER TABLE "ObrigacaoEconomica" ADD COLUMN IF NOT EXISTS "documentoId" INTEGER;
ALTER TABLE "ObrigacaoEconomica" ADD COLUMN IF NOT EXISTS "tipoServicoId" INTEGER;
ALTER TABLE "ObrigacaoEconomica" ADD COLUMN IF NOT EXISTS "phaseKey" VARCHAR(60);
ALTER TABLE "ObrigacaoEconomica" ADD COLUMN IF NOT EXISTS "phaseCycle" INTEGER;
ALTER TABLE "ObrigacaoEconomica" ADD COLUMN IF NOT EXISTS "configFinanceiraId" INTEGER;

-- ── Origem do lançamento + evento causador ──────────────────────────────────
ALTER TABLE "ObrigacaoEconomica" ADD COLUMN IF NOT EXISTS "origemLancamento" VARCHAR(28);
ALTER TABLE "ObrigacaoEconomica" ADD COLUMN IF NOT EXISTS "eventoOrigemTipo" VARCHAR(40);
ALTER TABLE "ObrigacaoEconomica" ADD COLUMN IF NOT EXISTS "eventoOrigemId" INTEGER;

-- ── Snapshot imutável do preço ──────────────────────────────────────────────
ALTER TABLE "ObrigacaoEconomica" ADD COLUMN IF NOT EXISTS "pricingRuleId" INTEGER;
ALTER TABLE "ObrigacaoEconomica" ADD COLUMN IF NOT EXISTS "valorUnitario" DECIMAL(14,2);
ALTER TABLE "ObrigacaoEconomica" ADD COLUMN IF NOT EXISTS "quantidade" INTEGER;
ALTER TABLE "ObrigacaoEconomica" ADD COLUMN IF NOT EXISTS "modoCalculoAplicado" VARCHAR(30);
ALTER TABLE "ObrigacaoEconomica" ADD COLUMN IF NOT EXISTS "naturezaPreco" VARCHAR(10);
ALTER TABLE "ObrigacaoEconomica" ADD COLUMN IF NOT EXISTS "contextoAplicado" JSONB;
ALTER TABLE "ObrigacaoEconomica" ADD COLUMN IF NOT EXISTS "dataReferencia" TIMESTAMP(3);

-- ── Idempotência garantida pelo BANCO ───────────────────────────────────────
-- Sem esta constraint, "concluir o passo duas vezes" seria uma corrida entre
-- duas transações e o MotorArtefato sozinho não impediria o custo duplicado.
ALTER TABLE "ObrigacaoEconomica" ADD COLUMN IF NOT EXISTS "chaveIdempotencia" VARCHAR(200);
CREATE UNIQUE INDEX IF NOT EXISTS "ObrigacaoEconomica_chaveIdempotencia_key"
  ON "ObrigacaoEconomica"("chaveIdempotencia");

-- ── Índices de leitura da Planilha Documental ───────────────────────────────
CREATE INDEX IF NOT EXISTS "ObrigacaoEconomica_documentoId_idx" ON "ObrigacaoEconomica"("documentoId");
CREATE INDEX IF NOT EXISTS "ObrigacaoEconomica_personId_idx" ON "ObrigacaoEconomica"("personId");
CREATE INDEX IF NOT EXISTS "ObrigacaoEconomica_processoId_documentoId_tipoServicoId_idx"
  ON "ObrigacaoEconomica"("processoId", "documentoId", "tipoServicoId");
