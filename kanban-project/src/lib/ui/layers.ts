// src/lib/ui/layers.ts
// ============================================================================
// FONTE ÚNICA de z-index das camadas de overlay do sistema (SSOT de layering).
// Elimina números mágicos espalhados. Nomes semânticos, ordem relativa estável.
//
// PROBLEMA que isto resolve: o modal do processo (atividade-details-modal.tsx)
// é um portal em document.body com backdrop z-9998 / painel z-9999. Qualquer
// modal financeiro aberto DE DENTRO dele que também seja portal em body precisa
// de z-index ACIMA de 9999, senão renderiza ATRÁS do painel do processo (fica
// invisível/inerte — "menu abre, ação não funciona"). A rota standalone não tem
// o modal-pai, por isso mascarava o bug.
//
// Uso: nos overlays-raiz, aplicar `style={{ zIndex: LAYER.aboveProcess }}` (ou a
// camada apropriada) e NÃO usar z-[...] cravado. Backdrop e painel de um mesmo
// modal podem compartilhar a mesma camada — a ordem no DOM decide o empilhamento.
// ============================================================================

export const LAYER = {
  // Referências (definidas por atividade-details-modal.tsx — NÃO alterar lá).
  processModalBackdrop: 9998, // backdrop do modal do processo
  processModal: 9999,         // painel do modal do processo

  // Camadas acima do modal do processo (SSOT — usar estas nos modais financeiros).
  aboveProcess: 10000,          // modal padrão acima do processo (editar, fatura, pagamento, lançamento, distribuição)
  aboveProcessDrawer: 10020,    // drawer lateral acima do processo (ex.: detalhe do participante)
  aboveProcessCritical: 10040,  // modal destrutivo/crítico acima do processo (estornar, cancelar, arquivar, renegociar)

  // Camadas transitórias acima de qualquer modal.
  popover: 10060, // menus/popovers efêmeros
  toast: 10080,   // notificações/toasts (sempre no topo)
} as const

export type LayerName = keyof typeof LAYER
