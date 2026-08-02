-- Condição de Pagamento como REGRA REUTILIZÁVEL do motor (não representa Cobrança).
-- 100% aditivo: colunas novas com default; registros existentes seguem válidos.
-- Nenhum drop, nenhuma perda de dado.

ALTER TABLE "CondicaoPagamento"
  ADD COLUMN IF NOT EXISTS "politicaTaxas"            VARCHAR(30)   NOT NULL DEFAULT 'IGNORAR',
  ADD COLUMN IF NOT EXISTS "formaSugeridaId"          INTEGER,
  ADD COLUMN IF NOT EXISTS "entradaTipo"              VARCHAR(20),
  ADD COLUMN IF NOT EXISTS "entradaMin"               DECIMAL(12,2),
  ADD COLUMN IF NOT EXISTS "entradaMax"               DECIMAL(12,2),
  ADD COLUMN IF NOT EXISTS "entradaCompoeTotal"       BOOLEAN       NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "entradaAdicional"         BOOLEAN       NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "diaInexistente"           VARCHAR(20),
  ADD COLUMN IF NOT EXISTS "comportamentoFimSemana"   VARCHAR(20),
  ADD COLUMN IF NOT EXISTS "comportamentoFeriado"     VARCHAR(20),
  ADD COLUMN IF NOT EXISTS "multaTipo"                VARCHAR(20),
  ADD COLUMN IF NOT EXISTS "multaValor"               DECIMAL(12,2),
  ADD COLUMN IF NOT EXISTS "jurosTipo"                VARCHAR(20),
  ADD COLUMN IF NOT EXISTS "jurosPeriodo"             VARCHAR(20),
  ADD COLUMN IF NOT EXISTS "carenciaDias"             INTEGER,
  ADD COLUMN IF NOT EXISTS "descontoTipo"             VARCHAR(20),
  ADD COLUMN IF NOT EXISTS "descontoAntecipacaoAuto"  BOOLEAN       NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "quemConcedeDesconto"      VARCHAR(40),
  ADD COLUMN IF NOT EXISTS "perfil"                   VARCHAR(60),
  ADD COLUMN IF NOT EXISTS "canal"                    VARCHAR(60),
  ADD COLUMN IF NOT EXISTS "servicos"                 INTEGER[]     NOT NULL DEFAULT '{}';
