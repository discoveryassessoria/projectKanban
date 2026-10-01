// lib/operacional/torre-desfazer.ts
// ============================================================================
// A JANELA DO "DESFAZER" DA TORRE — UMA CONSTANTE ÚNICA (Torre nova, 01/10/2026). Módulo PURO (cliente e servidor).
//
// O protótipo define UM tempo para o Desfazer: "com 'Desfazer' disponível por 24 h" (tela final de Revisar o dia). Antes havia
// 30 s no servidor, 30 s no cliente e nenhuma janela em outras portas (Precisa de você, reativar processo). Agora TODO "Desfazer"
// da Torre — atribuição, prioridade, prazo, distribuição, "Aplicar saída", marcar ausência, troca de canal, desbloqueio, pausa —
// vale pelo MESMO tempo e só para quem fez a ação. Para mudar o tempo, muda-se AQUI e em mais nenhum lugar (o teste varre o
// código atrás de uma segunda janela).
//
// A janela nunca é a única proteção: todo Desfazer ainda lê o próprio LogAuditoria do fato e RECUSA se algo mudou depois.
// ============================================================================

/** 24 h — o tempo que o protótipo promete ("Desfazer disponível por 24 h"). */
export const JANELA_DO_DESFAZER_MS = 24 * 60 * 60 * 1000

/** O mesmo tempo, por extenso, para as mensagens ("passaram mais de 24 horas"). */
export const JANELA_DO_DESFAZER_TEXTO = '24 horas'

/** O fato aconteceu dentro da janela? (`agora` injetável: testes e servidor usam o relógio que quiserem.) */
export function dentroDaJanelaDoDesfazer(feitoEm: Date | number, agora: Date | number = Date.now()): boolean {
  const t = feitoEm instanceof Date ? feitoEm.getTime() : feitoEm
  const a = agora instanceof Date ? agora.getTime() : agora
  return a - t <= JANELA_DO_DESFAZER_MS
}
