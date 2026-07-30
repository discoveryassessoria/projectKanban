// src/lib/genealogia/navegacao/historico.ts
//
// Histórico de navegação da árvore — reducer puro, sem React e sem DOM.
//
// Regra da Constituição: não usar o histórico do navegador para estado que
// pertence à árvore. Voltar do teclado do navegador dentro do modal do
// processo fecharia o processo inteiro; o operador perderia o contexto que a
// árvore existe para preservar. Aqui o voltar/avançar é da ÁRVORE.
//
// Sendo puro, o comportamento (o que empilha, o que substitui, o que não gera
// entrada) é testável sem montar tela — que é onde esse tipo de estado costuma
// apodrecer silenciosamente.

export type ModoVisao =
  | "completa"
  | "ascendentes"
  | "descendentes"
  | "linha"
  | "familia"
  | "ramo"

export interface PontoNavegacao {
  modo: ModoVisao
  /** Ponto focal do modo (ascendentes/descendentes/família/ramo). */
  focoId: number | null
  /** Pessoa selecionada — abre o painel lateral. */
  selecionadaId: number | null
  /** Zoom no momento da navegação; restaurado ao voltar. */
  zoom: number | null
  /** Rótulo curto para a UI de histórico ("Ascendentes de Giovanni"). */
  rotulo: string
}

export interface EstadoHistorico {
  pilha: PontoNavegacao[]
  indice: number
}

const TETO = 50

export function estadoInicial(ponto: PontoNavegacao): EstadoHistorico {
  return { pilha: [ponto], indice: 0 }
}

export function atual(e: EstadoHistorico): PontoNavegacao {
  return e.pilha[e.indice]
}

export function podeVoltar(e: EstadoHistorico): boolean {
  return e.indice > 0
}

export function podeAvancar(e: EstadoHistorico): boolean {
  return e.indice < e.pilha.length - 1
}

/**
 * Duas navegações são "a mesma parada" quando modo, foco e seleção coincidem.
 * O zoom NÃO entra na comparação: se entrasse, cada rolagem de roda viraria uma
 * entrada e o voltar deixaria de andar entre lugares para andar entre frames.
 */
function mesmaParada(a: PontoNavegacao, b: PontoNavegacao): boolean {
  return a.modo === b.modo && a.focoId === b.focoId && a.selecionadaId === b.selecionadaId
}

/**
 * Registra uma navegação. Ir para um lugar quando já se está nele apenas
 * atualiza o zoom da entrada corrente — nunca cria uma parada duplicada.
 * Navegar depois de ter voltado descarta o "futuro", como qualquer histórico.
 */
export function navegar(e: EstadoHistorico, destino: PontoNavegacao): EstadoHistorico {
  const corrente = atual(e)
  if (corrente && mesmaParada(corrente, destino)) {
    const pilha = [...e.pilha]
    pilha[e.indice] = { ...corrente, zoom: destino.zoom ?? corrente.zoom, rotulo: destino.rotulo }
    return { pilha, indice: e.indice }
  }

  const cortada = e.pilha.slice(0, e.indice + 1)
  cortada.push(destino)
  const excedente = Math.max(0, cortada.length - TETO)
  const pilha = excedente ? cortada.slice(excedente) : cortada
  return { pilha, indice: pilha.length - 1 }
}

export function voltar(e: EstadoHistorico): EstadoHistorico {
  if (!podeVoltar(e)) return e
  return { pilha: e.pilha, indice: e.indice - 1 }
}

export function avancar(e: EstadoHistorico): EstadoHistorico {
  if (!podeAvancar(e)) return e
  return { pilha: e.pilha, indice: e.indice + 1 }
}

/**
 * Atualiza só o zoom da parada corrente, sem criar entrada. Usado quando o
 * operador ajusta o enquadramento: ao voltar para cá depois, o zoom volta
 * como ele deixou.
 */
export function registrarZoom(e: EstadoHistorico, zoom: number): EstadoHistorico {
  const corrente = atual(e)
  if (!corrente || corrente.zoom === zoom) return e
  const pilha = [...e.pilha]
  pilha[e.indice] = { ...corrente, zoom }
  return { pilha, indice: e.indice }
}

/** Paradas anteriores, da mais recente para a mais antiga (para menu de voltar). */
export function anteriores(e: EstadoHistorico, limite = 8): PontoNavegacao[] {
  return e.pilha.slice(Math.max(0, e.indice - limite), e.indice).reverse()
}
