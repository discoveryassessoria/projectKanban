// src/lib/documentos/extenso-pt.ts
//
// NÚMERO POR EXTENSO (português) → inteiro. Vocabulário FECHADO e determinístico —
// tabela de busca, nunca "adivinhação" de modelo. Certidão de registro civil
// brasileira escreve datas por extenso ("vinte e cinco de junho de mil novecentos e
// dez"); sem isto não dá pra extrair data nenhuma do texto corrido.

const UNIDADES: Record<string, number> = {
  zero: 0, um: 1, uma: 1,
  // "Ao PRIMEIRO dia do mez..." — dia 1 do mês é sempre escrito por ordinal, nunca
  // "dia um", em qualquer época do registro civil brasileiro.
  primeiro: 1,
  dois: 2, duas: 2, tres: 3, três: 3, quatro: 4, cinco: 5,
  seis: 6, sete: 7, oito: 8, nove: 9,
}
const DEZ_A_DEZENOVE: Record<string, number> = {
  dez: 10, onze: 11, doze: 12, treze: 13, quatorze: 14, catorze: 14, quinze: 15,
  dezesseis: 16, dezessete: 17, dezoito: 18, dezenove: 19,
}
const DEZENAS: Record<string, number> = {
  vinte: 20, trinta: 30, quarenta: 40, cinquenta: 50, sessenta: 60,
  setenta: 70, oitenta: 80, noventa: 90,
}
const CENTENAS: Record<string, number> = {
  cem: 100, cento: 100, duzentos: 200, duzentas: 200, trezentos: 300, trezentas: 300,
  quatrocentos: 400, quatrocentas: 400, quinhentos: 500, quinhentas: 500,
  seiscentos: 600, seiscentas: 600, setecentos: 700, setecentas: 700,
  oitocentos: 800, oitocentas: 800, novecentos: 900, novecentas: 900,
}
export const MESES: Record<string, number> = {
  janeiro: 1, fevereiro: 2, marco: 3, março: 3, abril: 4, maio: 5, junho: 6,
  julho: 7, agosto: 8, setembro: 9, outubro: 10, novembro: 11, dezembro: 12,
}

function semAcento(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
}
function palavras(s: string): string[] {
  return semAcento(s).toLowerCase().replace(/[^a-z\s]/g, " ").split(/\s+/).filter(Boolean)
}

/**
 * "vinte e cinco" → 25, "mil novecentos e dez" → 1910, "trinta e quatro" → 34.
 * Devolve null quando a sequência de palavras não forma um número reconhecível —
 * NUNCA um palpite: ou é um número por extenso de verdade, ou não é nada.
 */
export function extensoParaNumero(texto: string): number | null {
  const ws = palavras(texto).filter((w) => w !== "e")
  if (!ws.length) return null

  let total = 0
  let atual = 0
  let achouAlgo = false

  for (const w of ws) {
    if (w === "mil") {
      total += (atual || 1) * 1000
      atual = 0
      achouAlgo = true
      continue
    }
    if (w in CENTENAS) { atual += CENTENAS[w]; achouAlgo = true; continue }
    if (w in DEZENAS) { atual += DEZENAS[w]; achouAlgo = true; continue }
    if (w in DEZ_A_DEZENOVE) { atual += DEZ_A_DEZENOVE[w]; achouAlgo = true; continue }
    if (w in UNIDADES) { atual += UNIDADES[w]; achouAlgo = true; continue }
    // Palavra fora do vocabulário: antes de começar a achar número, é só
    // preenchimento à esquerda ("com", "contando", preposição do texto corrido em
    // torno do trecho recortado) — ignora e segue procurando. Depois de já ter
    // achado número, é o fim da sequência.
    if (achouAlgo) break
  }
  if (!achouAlgo) return null
  return total + atual
}

/**
 * "aos vinte e cinco dias do mês de junho de mil novecentos e dez" → "1910-06-25".
 * Só devolve data quando dia, mês e ano foram todos reconhecidos — data parcial
 * não vira data errada, vira null (fica pendente de revisão humana).
 */
export function extrairDataPorExtenso(texto: string): string | null {
  const t = semAcento(texto).toLowerCase()

  // "mês"/"mez": grafia mudou na reforma ortográfica de 1943 — registro anterior a
  // isso (comum nas certidões antigas que fundamentam cidadania) escreve com Z.
  // dia: número por extenso logo antes de "dia(s)"
  const mDia = t.match(/([a-z\s]+?)\s+dias?\s+(?:do\s+me[sz]|de)/)
  const dia = mDia ? extensoParaNumero(mDia[1]) : null

  // mês: nome do mês (por extenso, não numérico)
  const mMes = t.match(/me[sz]\s+de\s+([a-z]+)/) || t.match(/de\s+(janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\s+de/)
  const mes = mMes ? MESES[mMes[1]] : undefined

  // ano: sequência por extenso após "de", terminando antes de pontuação/preposição comum
  const mAno = t.match(/de\s+((?:mil|hum|um)[a-z\s]*?)(?:[,.]|\s+nest|\s+n[ea]st|\s+compareceu|\s+as\s+\d|\s+ante\b|$)/)
  const ano = mAno ? extensoParaNumero(mAno[1]) : null

  if (dia == null || !mes || ano == null || dia < 1 || dia > 31 || ano < 1800 || ano > 2100) return null
  return `${ano}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`
}

/** "trinta e quatro anos de idade" → 34. */
export function extrairIdadeDeclarada(texto: string): number | null {
  const t = semAcento(texto).toLowerCase()
  const m = t.match(/([a-z\s]+?)\s+anos?\s+de\s+idade/)
  if (!m) return null
  return extensoParaNumero(m[1])
}
