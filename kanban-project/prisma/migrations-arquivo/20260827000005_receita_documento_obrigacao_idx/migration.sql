-- F7.6 — Índice ausente em ReceitaDocumento.obrigacaoId.
-- A fonte única atual de documentos/comprovantes (custo E receita) é a OBRIGAÇÃO; sem este
-- índice toda leitura de comprovante fazia varredura completa da tabela. Aditivo, reversível,
-- não toca dado algum. IF NOT EXISTS = seguro para reexecução.
CREATE INDEX IF NOT EXISTS "ReceitaDocumento_obrigacaoId_idx" ON "ReceitaDocumento"("obrigacaoId");
