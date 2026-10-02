// src/lib/geografia/cidade-nascimento.ts
//
// CIDADE DE NASCIMENTO — regras puras (sem React, sem rede) do campo `Pessoa.local_nasc`.
//
// O campo continua uma STRING livre: "São Paulo", "Vicenza", "São Paulo (Santo
// Amaro)". O autocomplete do Brasil só SUGERE municípios do IBGE (lista estática
// versionada em `municipios-br.json`, carregada sob demanda — o runtime não depende
// de API externa); nunca obriga a escolher e nunca reescreve o que já está gravado.
//
// COMPLEMENTO entre parênteses (distrito/subdistrito) é parte do MESMO texto:
// "São Paulo (Santo Amaro)". O autocomplete só busca/troca a cidade (a parte antes
// do primeiro "("); o complemento e qualquer valor já gravado atravessam intactos.

export interface MunicipioBr {
  nome: string
  uf: string
}

/** Forma do JSON estático: UF → nomes de município (ordem alfabética). */
export type MunicipiosPorUf = Record<string, string[]>

/** Minúsculo e sem acento: chave de busca/comparação (a base nunca é exibida assim). */
export function normalizarBusca(s: string | null | undefined): string {
  return String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim()
}

/**
 * O campo é UM texto só: "Cidade" ou "Cidade (complemento)". A parte antes do
 * primeiro "(" é a cidade — é ela que o autocomplete busca e troca.
 */
export function baseDaCidade(valor: string | null | undefined): string {
  const texto = String(valor ?? "")
  const i = texto.indexOf("(")
  return (i < 0 ? texto : texto.slice(0, i)).trim()
}

/** Complemento entre parênteses ("Santo Amaro"), sem os parênteses; "" quando não há. */
export function complementoDaCidade(valor: string | null | undefined): string {
  const m = /\(([^()]*)\)\s*$/.exec(String(valor ?? ""))
  return m ? m[1].trim() : ""
}

/**
 * Troca SÓ a cidade por um município escolhido na lista, preservando o complemento
 * já digitado: ("São Paulo (Santo Amaro)", "Santos") → "Santos (Santo Amaro)".
 */
export function trocarBase(valor: string | null | undefined, nome: string): string {
  const texto = String(valor ?? "")
  const i = texto.indexOf("(")
  return i < 0 ? nome : `${nome} ${texto.slice(i)}`
}

/** Achata o JSON por UF numa lista única, já com a chave de busca. */
export function achatarMunicipios(porUf: MunicipiosPorUf): Array<MunicipioBr & { chave: string }> {
  const lista: Array<MunicipioBr & { chave: string }> = []
  for (const uf of Object.keys(porUf).sort()) {
    for (const nome of porUf[uf]) lista.push({ nome, uf, chave: normalizarBusca(nome) })
  }
  return lista
}

/**
 * Sugestões para o texto digitado, em três grupos: nome IGUAL ao termo, nome que
 * COMEÇA com ele e nome que só o CONTÉM. Dentro de cada grupo, o nome mais curto
 * primeiro ("São Paulo" antes de "São Paulo do Potengi"), depois alfabético e UF
 * (homônimos aparecem um por UF). Termo com menos de 2 letras = nada.
 */
export function sugerirMunicipios(
  lista: ReadonlyArray<MunicipioBr & { chave: string }>,
  termo: string,
  limite = 20,
): MunicipioBr[] {
  const t = normalizarBusca(termo)
  if (t.length < 2) return []
  const iguais: typeof lista[number][] = []
  const comeca: typeof lista[number][] = []
  const contem: typeof lista[number][] = []
  for (const m of lista) {
    if (m.chave === t) iguais.push(m)
    else if (m.chave.startsWith(t)) comeca.push(m)
    else if (m.chave.includes(t)) contem.push(m)
  }
  const ordem = (a: typeof lista[number], b: typeof lista[number]) =>
    a.chave.length - b.chave.length || a.chave.localeCompare(b.chave) || a.uf.localeCompare(b.uf)
  return [...iguais.sort(ordem), ...comeca.sort(ordem), ...contem.sort(ordem)]
    .slice(0, limite)
    .map((m) => ({ nome: m.nome, uf: m.uf }))
}

/** O país digitado é o Brasil? (aceita caixa/acento/"BR"). Só aí o autocomplete de município vale. */
export function paisEhBrasil(pais: string | null | undefined): boolean {
  const p = normalizarBusca(pais)
  return p === "brasil" || p === "brazil" || p === "br"
}
