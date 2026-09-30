-- ÁRVORE GENEALÓGICA = ÚNICA FONTE DE VERDADE DOCUMENTAL (30/09/2026).
--
-- Novo valor de StatusDocumento: NAO_EXIGIDO. Quando a árvore deixa de exigir uma
-- certidão (pessoa deixou de ser casada, faleceu, saiu da linha reta, regra
-- inativada…), o Documento derivado NÃO é apagado nem "cancelado" (CANCELADO é
-- decisão humana sobre o papel): ele passa a NAO_EXIGIDO e mantém anexos,
-- solicitações e histórico. Se a árvore voltar a exigir, o MESMO Documento é
-- reativado — nunca duplicado.
--
-- ADITIVO e IDEMPOTENTE: só acrescenta um valor de enum. Nenhum dado existente é
-- lido, alterado ou removido.

ALTER TYPE "StatusDocumento" ADD VALUE IF NOT EXISTS 'NAO_EXIGIDO';
