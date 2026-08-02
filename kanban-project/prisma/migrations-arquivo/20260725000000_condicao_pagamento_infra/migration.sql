-- ============================================================================
-- INFRAESTRUTURA DE PAGAMENTOS — Condições, Formas e Taxas
--
-- 100% ADITIVA: nenhuma coluna é removida ou renomeada, nenhum default
-- existente muda. Registros atuais permanecem válidos e o motor mantém o
-- comportamento histórico (1 parcela) enquanto não houver condição vinculada.
-- ============================================================================

-- ── CondicaoPagamento: identificação e versionamento ────────────────────────
ALTER TABLE "CondicaoPagamento" ADD COLUMN "codigo" VARCHAR(40);
ALTER TABLE "CondicaoPagamento" ADD COLUMN "descricao" TEXT;
ALTER TABLE "CondicaoPagamento" ADD COLUMN "versao" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "CondicaoPagamento" ADD COLUMN "substituiId" INTEGER;
ALTER TABLE "CondicaoPagamento" ADD COLUMN "vigenciaInicio" TIMESTAMP(3);
ALTER TABLE "CondicaoPagamento" ADD COLUMN "vigenciaFim" TIMESTAMP(3);

-- ── parcelamento ───────────────────────────────────────────────────────────
ALTER TABLE "CondicaoPagamento" ADD COLUMN "tipoPagamento" VARCHAR(20) NOT NULL DEFAULT 'PARCELADO';
ALTER TABLE "CondicaoPagamento" ADD COLUMN "entradaObrigatoria" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "CondicaoPagamento" ADD COLUMN "valorEntradaFixo" DECIMAL(12,2);
ALTER TABLE "CondicaoPagamento" ADD COLUMN "parcelasMin" INTEGER;
ALTER TABLE "CondicaoPagamento" ADD COLUMN "parcelasMax" INTEGER;
ALTER TABLE "CondicaoPagamento" ADD COLUMN "parcelasPadrao" INTEGER;
ALTER TABLE "CondicaoPagamento" ADD COLUMN "permiteParcelasPersonalizadas" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "CondicaoPagamento" ADD COLUMN "permiteEdicaoManual" BOOLEAN NOT NULL DEFAULT false;

-- ── cronograma ─────────────────────────────────────────────────────────────
ALTER TABLE "CondicaoPagamento" ADD COLUMN "inicioCronograma" VARCHAR(20) NOT NULL DEFAULT 'IMEDIATA';
ALTER TABLE "CondicaoPagamento" ADD COLUMN "primeiraParcelaDias" INTEGER;
ALTER TABLE "CondicaoPagamento" ADD COLUMN "primeiraParcelaData" TIMESTAMP(3);
ALTER TABLE "CondicaoPagamento" ADD COLUMN "periodicidade" VARCHAR(20) NOT NULL DEFAULT 'MENSAL';
ALTER TABLE "CondicaoPagamento" ADD COLUMN "periodicidadeDias" INTEGER;
ALTER TABLE "CondicaoPagamento" ADD COLUMN "diaFixo" INTEGER;
ALTER TABLE "CondicaoPagamento" ADD COLUMN "ajusteDiaUtil" VARCHAR(20) NOT NULL DEFAULT 'NENHUM';
ALTER TABLE "CondicaoPagamento" ADD COLUMN "ajustarFimDeSemana" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "CondicaoPagamento" ADD COLUMN "ajustarFeriados" BOOLEAN NOT NULL DEFAULT false;

-- ── distribuição ───────────────────────────────────────────────────────────
ALTER TABLE "CondicaoPagamento" ADD COLUMN "distribuicao" VARCHAR(30) NOT NULL DEFAULT 'ULTIMA_AJUSTA';
ALTER TABLE "CondicaoPagamento" ADD COLUMN "primeiraParcelaPercent" DECIMAL(5,2);

-- ── encargos (armazenados; aplicação em runtime é incremento seguinte) ─────
ALTER TABLE "CondicaoPagamento" ADD COLUMN "multaPercent" DECIMAL(7,4);
ALTER TABLE "CondicaoPagamento" ADD COLUMN "jurosMesPercent" DECIMAL(7,4);
ALTER TABLE "CondicaoPagamento" ADD COLUMN "descontoPercent" DECIMAL(7,4);
ALTER TABLE "CondicaoPagamento" ADD COLUMN "descontoAntecipacaoPercent" DECIMAL(7,4);
ALTER TABLE "CondicaoPagamento" ADD COLUMN "descontoAVistaPercent" DECIMAL(7,4);

-- ── câmbio ─────────────────────────────────────────────────────────────────
ALTER TABLE "CondicaoPagamento" ADD COLUMN "politicaCambio" VARCHAR(20) NOT NULL DEFAULT 'VARIAVEL';
ALTER TABLE "CondicaoPagamento" ADD COLUMN "travaCambial" BOOLEAN NOT NULL DEFAULT false;

-- ── restrições de uso ──────────────────────────────────────────────────────
ALTER TABLE "CondicaoPagamento" ADD COLUMN "aplicaA" VARCHAR(20) NOT NULL DEFAULT 'AMBOS';
ALTER TABLE "CondicaoPagamento" ADD COLUMN "moedasPermitidas" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "CondicaoPagamento" ADD COLUMN "valorMinimo" DECIMAL(12,2);
ALTER TABLE "CondicaoPagamento" ADD COLUMN "valorMaximo" DECIMAL(12,2);
ALTER TABLE "CondicaoPagamento" ADD COLUMN "paises" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "CondicaoPagamento" ADD COLUMN "modalidades" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "CondicaoPagamento" ADD COLUMN "tiposProcesso" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "CondicaoPagamento" ADD COLUMN "observacoes" TEXT;

CREATE INDEX "CondicaoPagamento_codigo_idx" ON "CondicaoPagamento"("codigo");
CREATE INDEX "CondicaoPagamento_substituiId_idx" ON "CondicaoPagamento"("substituiId");
CREATE UNIQUE INDEX "CondicaoPagamento_codigo_versao_key" ON "CondicaoPagamento"("codigo", "versao");

ALTER TABLE "CondicaoPagamento"
  ADD CONSTRAINT "CondicaoPagamento_substituiId_fkey"
  FOREIGN KEY ("substituiId") REFERENCES "CondicaoPagamento"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ── FormaPagamentoCadastro: capacidades do meio ────────────────────────────
ALTER TABLE "FormaPagamentoCadastro" ADD COLUMN "ativo" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "FormaPagamentoCadastro" ADD COLUMN "ordem" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "FormaPagamentoCadastro" ADD COLUMN "icone" VARCHAR(60);
ALTER TABLE "FormaPagamentoCadastro" ADD COLUMN "aceitaEntrada" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "FormaPagamentoCadastro" ADD COLUMN "aceitaRecorrencia" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "FormaPagamentoCadastro" ADD COLUMN "aceitaMoedaEstrangeira" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "FormaPagamentoCadastro" ADD COLUMN "observacoes" TEXT;

CREATE INDEX "FormaPagamentoCadastro_ativo_ordem_idx" ON "FormaPagamentoCadastro"("ativo", "ordem");

-- ── vínculo N:N condição ↔ forma de pagamento ──────────────────────────────
CREATE TABLE "CondicaoPagamentoForma" (
    "id" SERIAL NOT NULL,
    "condicaoId" INTEGER NOT NULL,
    "formaId" INTEGER NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CondicaoPagamentoForma_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CondicaoPagamentoForma_condicaoId_formaId_key" ON "CondicaoPagamentoForma"("condicaoId", "formaId");
CREATE INDEX "CondicaoPagamentoForma_condicaoId_idx" ON "CondicaoPagamentoForma"("condicaoId");
CREATE INDEX "CondicaoPagamentoForma_formaId_idx" ON "CondicaoPagamentoForma"("formaId");
ALTER TABLE "CondicaoPagamentoForma"
  ADD CONSTRAINT "CondicaoPagamentoForma_condicaoId_fkey"
  FOREIGN KEY ("condicaoId") REFERENCES "CondicaoPagamento"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CondicaoPagamentoForma"
  ADD CONSTRAINT "CondicaoPagamentoForma_formaId_fkey"
  FOREIGN KEY ("formaId") REFERENCES "FormaPagamentoCadastro"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── vínculo N:N condição ↔ taxa de pagamento ───────────────────────────────
CREATE TABLE "CondicaoPagamentoTaxa" (
    "id" SERIAL NOT NULL,
    "condicaoId" INTEGER NOT NULL,
    "taxaId" INTEGER NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CondicaoPagamentoTaxa_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CondicaoPagamentoTaxa_condicaoId_taxaId_key" ON "CondicaoPagamentoTaxa"("condicaoId", "taxaId");
CREATE INDEX "CondicaoPagamentoTaxa_condicaoId_idx" ON "CondicaoPagamentoTaxa"("condicaoId");
CREATE INDEX "CondicaoPagamentoTaxa_taxaId_idx" ON "CondicaoPagamentoTaxa"("taxaId");
ALTER TABLE "CondicaoPagamentoTaxa"
  ADD CONSTRAINT "CondicaoPagamentoTaxa_condicaoId_fkey"
  FOREIGN KEY ("condicaoId") REFERENCES "CondicaoPagamento"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CondicaoPagamentoTaxa"
  ADD CONSTRAINT "CondicaoPagamentoTaxa_taxaId_fkey"
  FOREIGN KEY ("taxaId") REFERENCES "TaxaPagamento"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── Configuração Financeira → Condição de Pagamento padrão ─────────────────
-- Nullable na adoção incremental: sem condição o motor mantém o comportamento
-- histórico. Torna-se obrigatório apenas depois do backfill de condições.
ALTER TABLE "ProdutoFinanceiro" ADD COLUMN "condicaoPagamentoId" INTEGER;
CREATE INDEX "ProdutoFinanceiro_condicaoPagamentoId_idx" ON "ProdutoFinanceiro"("condicaoPagamentoId");
ALTER TABLE "ProdutoFinanceiro"
  ADD CONSTRAINT "ProdutoFinanceiro_condicaoPagamentoId_fkey"
  FOREIGN KEY ("condicaoPagamentoId") REFERENCES "CondicaoPagamento"("id") ON DELETE SET NULL ON UPDATE CASCADE;
