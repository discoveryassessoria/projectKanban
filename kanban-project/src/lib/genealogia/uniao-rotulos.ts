// src/lib/genealogia/uniao-rotulos.ts
//
// Rótulos do vínculo do casal exibidos na página da pessoa. PURO.
//
// O cartão do casal já tem o título "Casamento"; repetir ali o `tipo` gravado
// ("casamento", "casamento_civil") mostrava "Casamento / casamento" — duas linhas
// dizendo a mesma coisa. Só o que ACRESCENTA informação sobrevive ("civil",
// "religioso"); o resto é null e a linha nem é desenhada.

/** "casamento" → null; "casamento_civil" → "Civil"; "religioso" → "Religioso". */
export function rotuloTipoDaUniao(tipo: string | null | undefined): string | null {
  const limpo = (tipo ?? "").trim().toLowerCase().replace(/[_-]+/g, " ")
  const resto = limpo.replace(/^casamento\b\s*/, "").trim()
  if (!resto) return null
  return resto.charAt(0).toUpperCase() + resto.slice(1)
}

/** "Cidade, Estado, País" só com o que está preenchido; "" quando nada. */
export function localDaUniao(u: { local?: string | null; estado?: string | null; pais?: string | null }): string {
  return [u.local, u.estado, u.pais].map((v) => v?.trim()).filter(Boolean).join(", ")
}
