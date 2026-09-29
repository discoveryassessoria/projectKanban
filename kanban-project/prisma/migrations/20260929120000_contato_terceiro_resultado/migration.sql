-- Torre de Controle, Bloco B (29/09/2026): o resultado real de um contato
-- com o terceiro — SEM_RESPOSTA/CONFIRMOU_PEDIDO/PEDIU_DOCUMENTO/EM_BUSCA/
-- NAO_LOCALIZOU/ENVIOU. Contatos existentes eram todos do fluxo antigo de
-- "Cobrar" (mandava e não sabia o resultado) — backfill honesto: SEM_RESPOSTA.
ALTER TABLE "ContatoTerceiro" ADD COLUMN "resultado" VARCHAR(20) NOT NULL DEFAULT 'SEM_RESPOSTA';
