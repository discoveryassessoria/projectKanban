-- CICLO DE VIDA DA PESSOA DENTRO DO PROCESSO
-- Estritamente ADITIVA: nenhuma coluna removida, nenhum dado alterado.
-- Idempotente: reexecutar nao falha.
--
-- Por que existe: remover alguem da arvore precisava de duas saidas — apagar a
-- cadeia derivada (quando nao ha fato historico) ou INATIVAR o vinculo
-- preservando o fato. A segunda saida nao tinha onde ser registrada.

-- 1) VINCULO PESSOA<->PROCESSO — remocao com preservacao de historico.
ALTER TABLE "ProcessoRequerente" ADD COLUMN IF NOT EXISTS "removidoEm"    TIMESTAMP(3);
ALTER TABLE "ProcessoRequerente" ADD COLUMN IF NOT EXISTS "removidoPorId" INTEGER;
ALTER TABLE "ProcessoRequerente" ADD COLUMN IF NOT EXISTS "motivoRemocao" VARCHAR(300);
CREATE INDEX IF NOT EXISTS "ProcessoRequerente_removidoEm_idx"
  ON "ProcessoRequerente"("removidoEm");

-- 2) NO DA ARVORE — sai da arvore ativa sem apagar a linha que os fatos citam.
ALTER TABLE "Pessoa" ADD COLUMN IF NOT EXISTS "removidaEm"    TIMESTAMP(3);
ALTER TABLE "Pessoa" ADD COLUMN IF NOT EXISTS "removidaPorId" INTEGER;
ALTER TABLE "Pessoa" ADD COLUMN IF NOT EXISTS "motivoRemocao" VARCHAR(300);
CREATE INDEX IF NOT EXISTS "Pessoa_removidaEm_idx" ON "Pessoa"("removidaEm");

-- 3) IDENTIDADE CANONICA — uma Pessoa tem no maximo UM Requerente.
--    E esta constraint que torna a reinsercao estruturalmente nao-duplicante:
--    sem ela, dois Requerente podiam apontar para o mesmo no da arvore.
--    Em Postgres, NULL nao conflita com NULL: o cadastro de clientes sem no na
--    arvore (a maioria) continua livre.
CREATE UNIQUE INDEX IF NOT EXISTS "Requerente_personId_key" ON "Requerente"("personId");

-- 4) PARTICIPANTE FINANCEIRO — um requerente aparece UMA vez por receita.
--    A tabela so tinha unicidade por (receitaId, idx), que e posicao na lista:
--    dois idx diferentes para o mesmo requerente passavam.
CREATE UNIQUE INDEX IF NOT EXISTS "ReceitaRequerente_receitaId_requerenteId_key"
  ON "ReceitaRequerente"("receitaId", "requerenteId");
