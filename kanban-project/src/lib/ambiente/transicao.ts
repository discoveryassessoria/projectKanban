// src/lib/ambiente/transicao.ts
//
// Decisões PURAS do crossfade/rotação — testáveis sem DOM. A parte que toca o
// DOM (preload de Image, timers, opacity) fica no componente; a lógica de
// "quando/qual/quanto tempo" mora aqui.

/** Próximo índice cíclico (0 quando não há imagens). */
export function proximoIndice(len: number, atual: number): number {
  return len > 0 ? (atual + 1) % len : 0
}

/** Índice inicial válido a partir do determinístico. */
export function indiceInicialValido(len: number, deterministico: number): number {
  return len > 0 ? ((deterministico % len) + len) % len : 0
}

/** Rotaciona SÓ com >1 imagem, aba visível e sem transição em andamento. */
export function deveRotacionar(imagensLen: number, abaVisivel: boolean, emTransicao: boolean): boolean {
  return imagensLen > 1 && abaVisivel && !emTransicao
}

/** Duração do fade: 0 com reduced-motion; senão a duração do tipo. */
export function duracaoFade(
  reducedMotion: boolean,
  tipo: "pais" | "rotacao",
  fadePaisMs: number,
  fadeRotacaoMs: number,
): number {
  if (reducedMotion) return 0
  return tipo === "pais" ? fadePaisMs : fadeRotacaoMs
}
