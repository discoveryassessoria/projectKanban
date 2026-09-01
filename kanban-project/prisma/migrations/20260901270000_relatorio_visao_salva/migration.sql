-- VISÃO SALVA DE RELATÓRIO — a PERGUNTA, nunca a resposta.
--
-- Guarda a QuerySpec (domínio, nacionalidade, filtros, agrupamento, colunas,
-- ordenação). Reabrir refaz a consulta e traz dado fresco. Guardar o resultado
-- transformaria a visão numa fotografia velha se passando por relatório — e
-- numa segunda fonte de verdade ao lado da operação.
--
-- Aditiva: nenhuma tabela existente é tocada.

CREATE TABLE "RelatorioVisao" (
  "id"           SERIAL       PRIMARY KEY,
  "dominio"      VARCHAR(40)  NOT NULL,
  "nome"         VARCHAR(120) NOT NULL,
  "spec"         JSONB        NOT NULL,
  "usuarioId"    INTEGER      NOT NULL,
  "favorita"     BOOLEAN      NOT NULL DEFAULT false,
  "usadaEm"      TIMESTAMP(3),
  "criadoEm"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "atualizadoEm" TIMESTAMP(3) NOT NULL
);

ALTER TABLE "RelatorioVisao"
  ADD CONSTRAINT "RelatorioVisao_usuarioId_fkey"
  FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- O mesmo operador não tem duas visões com o mesmo nome no mesmo domínio.
CREATE UNIQUE INDEX "RelatorioVisao_usuarioId_dominio_nome_key" ON "RelatorioVisao"("usuarioId", "dominio", "nome");
CREATE INDEX "RelatorioVisao_usuarioId_dominio_idx"  ON "RelatorioVisao"("usuarioId", "dominio");
CREATE INDEX "RelatorioVisao_usuarioId_favorita_idx" ON "RelatorioVisao"("usuarioId", "favorita");
CREATE INDEX "RelatorioVisao_usuarioId_usadaEm_idx"  ON "RelatorioVisao"("usuarioId", "usadaEm");
