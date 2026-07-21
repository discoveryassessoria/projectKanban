// src/lib/catalogo/chave-tecnica-interna.ts
//
// CHAVE TÉCNICA INTERNA — gerada e mantida EXCLUSIVAMENTE no backend.
//
// O operador NUNCA informa nem vê a chave técnica (integração/regras/catálogo).
// Quando o modelo ainda exige um `code` único (ex.: ServicoProduto.code sincroniza
// ItemCatalogo.code; TipoDocumentoCadastro.code é referenciado por regras), o
// backend a DERIVA do nome na mesma transação da criação. Igual ao publicCode:
// automática, imutável, invisível.

/** Slug técnico a partir do nome de negócio (sem acento, MAIÚSCULO, _). */
export function slugTecnico(nome: string | null | undefined, fallback = "ITEM"): string {
  const base = (nome ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40)
  return base || fallback
}

/** Garante unicidade: acrescenta _2, _3… enquanto `existe(candidato)` for verdadeiro. */
export async function gerarChaveUnica(
  base: string,
  existe: (candidato: string) => Promise<boolean>,
): Promise<string> {
  let candidato = base
  let i = 1
  // teto defensivo para nunca laçar infinito
  while (i < 10000 && (await existe(candidato))) {
    i++
    candidato = `${base}_${i}`
  }
  return candidato
}
