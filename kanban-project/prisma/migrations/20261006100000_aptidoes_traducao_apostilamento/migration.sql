-- DUAS NOVAS UNIDADES DE TRABALHO (aptidões) para quem ENVIA DOCUMENTOS PARA FORA — Capacidade Operacional.
--
-- Aptidão = unidade de trabalho = `PerfilOperacionalDocumento` (a mesma natureza de "Emissão de Certidão"; não é fase). Duas linhas novas,
-- cada uma LIGADA ao Workflow Interno que cobre o trabalho — é o `workflowId` do perfil que diz à Torre que passos/tarefas a aptidão cobre:
--
--   ENVIO_TRADUCAO_JURAMENTADA  → Workflow Interno "Tradução Juramentada" (fase traducao_juramentada, passo `traducao_juramentada`)
--   ENVIO_APOSTILAMENTO         → Workflow Interno "Apostilamento"        (fase apostilamento,        passo `apostilamento`)
--
-- SÓ ADITIVA: dois INSERT ... WHERE NOT EXISTS (rodar de novo não duplica). Nada existente é alterado — nem o perfil "Emissão de Certidão",
-- nem as aptidões já cadastradas, nem os tipos documentais. O workflow é resolvido pela CHAVE DA FASE (o id difere entre ambientes):
-- o vigente = ativo, para todos os tipos de processo, não arquivado e que não é cópia de biblioteca. Se o ambiente não tiver esse workflow
-- (banco de teste), `workflowId` fica nulo — o perfil existe e a ligação se completa quando o workflow existir.

INSERT INTO "PerfilOperacionalDocumento"
  ("code", "name", "descricao", "workflowId", "familiaDocumentalId", "escopoInstanciacao", "exigeProcesso", "exigePessoa", "exigeDocumento", "ativo", "sistema", "createdAt", "updatedAt")
SELECT
  'ENVIO_TRADUCAO_JURAMENTADA',
  'Envio para tradução juramentada',
  'Separar a certidão pronta, enviar ao tradutor juramentado, acompanhar e receber a tradução. Uma execução por documento.',
  (SELECT w."id" FROM "PhaseInternalWorkflow" w
    WHERE w."phaseKey" = 'traducao_juramentada' AND w."active" = true AND w."arquivado" = false AND w."tipoProcessoId" IS NULL AND w."origemBiblioteca" = false
    ORDER BY w."id" LIMIT 1),
  NULL, 'DOCUMENTO', true, true, true, true, true, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM "PerfilOperacionalDocumento" WHERE "code" = 'ENVIO_TRADUCAO_JURAMENTADA');

INSERT INTO "PerfilOperacionalDocumento"
  ("code", "name", "descricao", "workflowId", "familiaDocumentalId", "escopoInstanciacao", "exigeProcesso", "exigePessoa", "exigeDocumento", "ativo", "sistema", "createdAt", "updatedAt")
SELECT
  'ENVIO_APOSTILAMENTO',
  'Envio para apostilamento',
  'Separar o documento, enviar ao cartório para apostilar, acompanhar e receber de volta. Uma execução por documento.',
  (SELECT w."id" FROM "PhaseInternalWorkflow" w
    WHERE w."phaseKey" = 'apostilamento' AND w."active" = true AND w."arquivado" = false AND w."tipoProcessoId" IS NULL AND w."origemBiblioteca" = false
    ORDER BY w."id" LIMIT 1),
  NULL, 'DOCUMENTO', true, true, true, true, true, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM "PerfilOperacionalDocumento" WHERE "code" = 'ENVIO_APOSTILAMENTO');
