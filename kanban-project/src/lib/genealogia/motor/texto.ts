// src/lib/genealogia/motor/texto.ts
//
// Normalização, fonética e distância — a base de TODA comparação de nomes,
// locais e sobrenomes do motor. Genealogia de cidadania vive de grafia
// instável: Bianchi/Bianqui, Sousa/Souza, Schmidt/Schmitt, Gonçalves/Goncalvez.
// Comparar string crua produz falso negativo; comparar só fonética produz falso
// positivo. O motor sempre usa os dois eixos juntos.

// Memo compartilhado. `normalizar` e `chaveFonetica` são chamadas dezenas de
// milhares de vezes numa análise (comparação de duplicidade é quadrática dentro
// do bucket) e ambas fazem NFD + várias regex. Sem cache, o custo delas domina
// o motor inteiro. Teto simples evita crescer sem limite em sessão longa.
const TETO_MEMO = 40_000
const memoNormalizar = new Map<string, string>()
const memoFonetica = new Map<string, string>()

function comMemo(cache: Map<string, string>, chave: string, calcular: () => string): string {
  const cached = cache.get(chave)
  if (cached !== undefined) return cached
  const valor = calcular()
  if (cache.size >= TETO_MEMO) cache.clear()
  cache.set(chave, valor)
  return valor
}

/** Remove acentos, pontuação e caixa. Base de qualquer comparação. */
export function normalizar(v: string | null | undefined): string {
  if (!v) return ""
  return comMemo(memoNormalizar, v, () =>
    v
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toUpperCase()
      .replace(/[^A-Z0-9\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim(),
  )
}

/** Partículas que não identificam família (de, di, da, van, von...). */
const PARTICULAS = new Set([
  "DE", "DA", "DO", "DAS", "DOS", "DI", "DEL", "DELLA", "DELLE", "DEI", "DEGLI",
  "LA", "LE", "LO", "LI", "VAN", "VON", "DER", "DEN", "Y", "E", "SAN", "SANTA",
])

/** Tokens significativos de um nome (sem partículas). */
export function tokensNome(v: string | null | undefined): string[] {
  return normalizar(v)
    .split(" ")
    .filter((t) => t.length > 1 && !PARTICULAS.has(t))
}

/**
 * Chave fonética canônica para sobrenomes latinos/germânicos.
 * Não é Soundex (que é anglocêntrico e destrói sobrenomes italianos):
 * é uma canonicalização ortográfica das variações que realmente ocorrem em
 * documentos de imigração PT/IT/ES/DE.
 */
export function chaveFonetica(v: string | null | undefined): string {
  if (!v) return ""
  return comMemo(memoFonetica, v, () => calcularFonetica(v))
}

function calcularFonetica(v: string): string {
  let s = normalizar(v).replace(/\s/g, "")
  if (!s) return ""

  s = s
    .replace(/PH/g, "F")
    .replace(/GH/g, "G")
    .replace(/SCH/g, "S")   // Schmidt/Smit
    .replace(/CH/g, "C")    // Bianchi/Bianci
    .replace(/QU/g, "C")
    .replace(/Q/g, "C")
    .replace(/K/g, "C")
    .replace(/W/g, "V")
    .replace(/Y/g, "I")
    .replace(/H/g, "")
    .replace(/LH/g, "L")
    .replace(/NH/g, "N")
    .replace(/GN/g, "N")    // Bologna/Bolonha
    .replace(/[ÇX]/g, "S")
    .replace(/Z/g, "S")
    .replace(/TT/g, "T")
    .replace(/DT/g, "T")    // Schmidt/Schmitt
    .replace(/G([EI])/g, "J$1")
    .replace(/C([EI])/g, "S$1")

  // colapsa letras repetidas (Rossi/Rosi, Ferrari/Ferrarri)
  s = s.replace(/(.)\1+/g, "$1")
  // vogais finais são o ruído nº 1 (Silva/Silvo, Ferrari/Ferraro)
  s = s.replace(/[AEIOU]+$/g, "")
  return s
}

/** Distância de Levenshtein com corte (early exit) — O(n·m) só quando precisa. */
export function levenshtein(a: string, b: string, maxDist = Infinity): number {
  if (a === b) return 0
  if (Math.abs(a.length - b.length) > maxDist) return maxDist + 1
  const m = a.length
  const n = b.length
  if (m === 0) return n
  if (n === 0) return m

  let prev = new Array<number>(n + 1)
  let cur = new Array<number>(n + 1)
  for (let j = 0; j <= n; j++) prev[j] = j

  for (let i = 1; i <= m; i++) {
    cur[0] = i
    let melhorLinha = cur[0]
    const ca = a.charCodeAt(i - 1)
    for (let j = 1; j <= n; j++) {
      const custo = ca === b.charCodeAt(j - 1) ? 0 : 1
      cur[j] = Math.min(cur[j - 1] + 1, prev[j] + 1, prev[j - 1] + custo)
      if (cur[j] < melhorLinha) melhorLinha = cur[j]
    }
    if (melhorLinha > maxDist) return maxDist + 1
    const tmp = prev
    prev = cur
    cur = tmp
  }
  return prev[n]
}

/** Jaro-Winkler — melhor que Levenshtein para nomes próprios curtos. */
export function jaroWinkler(a: string, b: string): number {
  if (!a || !b) return 0
  if (a === b) return 1
  const matchWindow = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1)
  const aMatch = new Array<boolean>(a.length).fill(false)
  const bMatch = new Array<boolean>(b.length).fill(false)
  let matches = 0

  for (let i = 0; i < a.length; i++) {
    const ini = Math.max(0, i - matchWindow)
    const fim = Math.min(i + matchWindow + 1, b.length)
    for (let j = ini; j < fim; j++) {
      if (bMatch[j] || a[i] !== b[j]) continue
      aMatch[i] = true
      bMatch[j] = true
      matches++
      break
    }
  }
  if (matches === 0) return 0

  let transposicoes = 0
  let k = 0
  for (let i = 0; i < a.length; i++) {
    if (!aMatch[i]) continue
    while (!bMatch[k]) k++
    if (a[i] !== b[k]) transposicoes++
    k++
  }
  transposicoes /= 2

  const jaro =
    (matches / a.length + matches / b.length + (matches - transposicoes) / matches) / 3

  // bônus Winkler: prefixo comum (até 4) pesa mais em nomes próprios
  let prefixo = 0
  while (prefixo < 4 && prefixo < a.length && prefixo < b.length && a[prefixo] === b[prefixo]) {
    prefixo++
  }
  return jaro + prefixo * 0.1 * (1 - jaro)
}

/** Similaridade combinada 0..1: ortográfica + fonética. */
export function similaridadeNome(a: string | null | undefined, b: string | null | undefined): number {
  const na = normalizar(a)
  const nb = normalizar(b)
  if (!na || !nb) return 0
  if (na === nb) return 1

  const orto = jaroWinkler(na, nb)
  const fa = chaveFonetica(a)
  const fb = chaveFonetica(b)
  const fon = fa && fb ? (fa === fb ? 1 : jaroWinkler(fa, fb)) : 0

  return orto * 0.55 + fon * 0.45
}

/** Similaridade de local (cidade/comune/paróquia), tolerante a sufixos. */
export function similaridadeLocal(a: string | null | undefined, b: string | null | undefined): number {
  const ta = new Set(tokensNome(a))
  const tb = new Set(tokensNome(b))
  if (ta.size === 0 || tb.size === 0) return 0
  let inter = 0
  ta.forEach((t) => {
    if (tb.has(t)) inter++
  })
  if (inter > 0) return inter / Math.min(ta.size, tb.size)
  return similaridadeNome(a, b) > 0.9 ? 0.9 : 0
}

/**
 * Busca difusa com tolerância a erro de digitação.
 * Retorna 0..1; 0 = sem correspondência. Prioriza prefixo > substring > fuzzy.
 */
export function pontuarBusca(termo: string, alvo: string | null | undefined): number {
  const t = normalizar(termo)
  const a = normalizar(alvo)
  if (!t || !a) return 0
  if (a === t) return 1
  if (a.startsWith(t)) return 0.95
  if (a.includes(t)) return 0.85

  // prefixo de qualquer palavra ("gio" acha "Maria Giovanna")
  for (const palavra of a.split(" ")) {
    if (palavra.startsWith(t)) return 0.8
  }

  if (t.length < 3) return 0
  // typo tolerante: 1 erro até 5 chars, 2 até 8, 3 acima
  const tolerancia = t.length <= 5 ? 1 : t.length <= 8 ? 2 : 3
  for (const palavra of a.split(" ")) {
    if (Math.abs(palavra.length - t.length) > tolerancia + 1) continue
    const d = levenshtein(t, palavra, tolerancia)
    if (d <= tolerancia) return 0.75 - d * 0.08
  }
  if (chaveFonetica(t) && chaveFonetica(t) === chaveFonetica(a)) return 0.65
  return 0
}

/** Ano de uma data em qualquer formato aceito, sem armadilha de timezone. */
export function anoDe(d: Date | string | null | undefined): number | null {
  if (!d) return null
  if (typeof d === "string") {
    const m = d.match(/^(\d{4})-(\d{2})-(\d{2})/)
    if (m) return Number(m[1])
  }
  const dt = d instanceof Date ? d : new Date(d)
  if (isNaN(dt.getTime())) return null
  return dt.getUTCFullYear()
}

/** Data como timestamp UTC estável (meio-dia, imune a fuso). */
export function tsDe(d: Date | string | null | undefined): number | null {
  if (!d) return null
  if (typeof d === "string") {
    const m = d.match(/^(\d{4})-(\d{2})-(\d{2})/)
    if (m) return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12)
  }
  const dt = d instanceof Date ? d : new Date(d)
  if (isNaN(dt.getTime())) return null
  return Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate(), 12)
}

const DIA = 86400000

/** Diferença em anos (fracionária) entre duas datas. */
export function anosEntre(
  a: Date | string | null | undefined,
  b: Date | string | null | undefined,
): number | null {
  const ta = tsDe(a)
  const tb = tsDe(b)
  if (ta == null || tb == null) return null
  return (tb - ta) / (365.2425 * DIA)
}

/** Diferença em dias entre duas datas. */
export function diasEntre(
  a: Date | string | null | undefined,
  b: Date | string | null | undefined,
): number | null {
  const ta = tsDe(a)
  const tb = tsDe(b)
  if (ta == null || tb == null) return null
  return (tb - ta) / DIA
}

export function formatarData(d: Date | string | null | undefined): string {
  const ts = tsDe(d)
  if (ts == null) return ""
  const dt = new Date(ts)
  const dd = String(dt.getUTCDate()).padStart(2, "0")
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0")
  return `${dd}/${mm}/${dt.getUTCFullYear()}`
}

export function nomeCompleto(p: { nome: string; sobrenome?: string | null }): string {
  return p.sobrenome ? `${p.nome} ${p.sobrenome}` : p.nome
}
