// lib/operacional/atribuicao-origem.ts
// ============================================================================
// ATRIBUIÇÃO DE RESPONSÁVEL SÓ NA PÁGINA DO PROCESSO (07/10/2026 — regra do Marco; CLAUDE.md §41 d).
// A página `/torre/processo/[id]` manda `origem: "pagina-do-processo"` nas chamadas que atribuem. As rotas genéricas de atribuição RECUSAM a chamada sem esse marcador
// (HTTP 422, mensagem em português). O marcador pega o desvio de TELA e de script antigo; não é defesa contra quem forja o campo (a permissão continua sendo a da rota).
// O LOTE da Torre (`/api/torre/tarefas/lote`), «Distribuir» do processo, as regras da Torre e a equipe chamam o serviço direto: não passam por aqui.
// ============================================================================
export const ORIGEM_PAGINA_DO_PROCESSO = 'pagina-do-processo'
/** A SUCESSÃO EM MASSA (férias, afastamento): a carteira de UMA pessoa passa a outra — não é atribuição por processo; só `/api/tarefas/redistribuir` a aceita. */
export const ORIGEM_SUCESSAO_EM_MASSA = 'sucessao-em-massa'
export const CODIGO_ATRIBUICAO_SO_NA_PAGINA = 'ATRIBUICAO_SO_NA_PAGINA_DO_PROCESSO'
export const MENSAGEM_ATRIBUICAO_SO_NA_PAGINA = 'A atribuição de responsável é feita na página do processo. Abra o processo para atribuir.'

/** O corpo da requisição vem da página do processo? */
export function veioDaPaginaDoProcesso(corpo: unknown): boolean {
  return !!corpo && typeof corpo === 'object' && (corpo as { origem?: unknown }).origem === ORIGEM_PAGINA_DO_PROCESSO
}

/** Corpo padrão da recusa (use com status 422). */
export const respostaAtribuicaoSoNaPagina = () => ({ error: MENSAGEM_ATRIBUICAO_SO_NA_PAGINA, codigo: CODIGO_ATRIBUICAO_SO_NA_PAGINA })

/** A sucessão em massa vem da tela de Distribuição (carteira inteira de uma pessoa). */
export const veioDaSucessaoEmMassa = (corpo: unknown): boolean => !!corpo && typeof corpo === 'object' && (corpo as { origem?: unknown }).origem === ORIGEM_SUCESSAO_EM_MASSA
