// src/lib/process-stage/requerimento-opcional.ts
// ============================================================================
// REQUERIMENTO INTEIRO TEOR — OPCIONAL POR ENQUANTO (06/10/2026). Decisão do dono: os processos estão sendo colocados no ar e os requerimentos já foram
// enviados antes, então anexar o requerimento em "Solicitar certidão" NÃO é obrigatório agora. O anexo continua disponível (e, se anexado, é classificado como sempre).
//
// UMA chave só. Para voltar a exigir, mude para `true`: o servidor (canal cadastrado e em código, exigência de evidência por tipo e requisito da etapa) e a tela
// leem esta constante — nenhuma configuração de canal nem linha de ExigenciaEvidenciaEtapa foi alterada no banco.
// ============================================================================
export const REQUERIMENTO_ENVIADO_OBRIGATORIO = false

