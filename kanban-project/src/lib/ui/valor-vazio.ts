// src/lib/ui/valor-vazio.ts
//
// VALOR AUSENTE — "Não informado" como texto, nunca um traço cru sozinho na
// tela. Um "-" isolado obriga quem lê a adivinhar se é "vazio", "zero" ou um
// erro de carregamento; o texto tira a ambiguidade. Fonte única para não
// duplicar o mesmo fallback string por string em cada tela.

export const NAO_INFORMADO = "Não informado"

/** `exibirOuNaoInformado(pessoa.telefone)` → o valor, ou "Não informado" quando vazio/nulo. */
export function exibirOuNaoInformado(valor: string | number | null | undefined): string {
  if (valor == null) return NAO_INFORMADO
  const texto = String(valor).trim()
  return texto.length === 0 ? NAO_INFORMADO : texto
}
