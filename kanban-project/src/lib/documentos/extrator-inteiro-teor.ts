// src/lib/documentos/extrator-inteiro-teor.ts
//
// CAMADA 2 — TEXTO → CAMPO. Recebe o texto já transcrito (Documento.transcricaoTexto,
// produzido pelo motor de OCR em src/services/registral/ocr/) e extrai os campos que
// a Análise Documental compara (`ad-v2-engine.ts`).
//
// REGRA DE OURO: nunca inventa. Cada campo só é preenchido quando o texto contém a
// âncora esperada — o boilerplate do Registro Civil brasileiro (Lei 6.015/73), que é
// nacionalmente padronizado ("filho(a) legítimo(a) de ... e de ...", "sendo avós
// paternos ... e ... e maternos ... e ...", "natural de ..."). Campo sem âncora clara
// fica undefined — vira pendência pro editor humano preencher, nunca um palpite.
//
// A extração é TEMPLATE/REGRA, não um modelo de linguagem "interpretando livremente"
// o texto — decisão deliberada (ver ADR da sessão): resultado determinístico,
// reproduzível, auditável campo a campo.

import { extrairDataPorExtenso, extrairIdadeDeclarada } from "./extenso-pt"

export interface CampoExtraido<T> {
  valor: T
  /** Trecho do texto de onde saiu — pro humano conferir sem reabrir o documento. */
  origem: string
}
export type Extraido<T> = CampoExtraido<T> | undefined

function semAcento(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
}
function tituloCase(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .map((w) => (["de", "da", "do", "das", "dos", "e"].includes(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ")
}

/**
 * Cabeçalho estruturado da "Certidão em Inteiro Teor" (formato e-CRC, pós-2015):
 *
 *   NOME
 *   IVONE BONEN MEDINA
 *   MATRÍCULA
 *   100206 01 55 1938 1 00019 004 0010194 98
 *
 * Rótulo numa linha, valor na linha seguinte — alta confiança, é campo de
 * formulário, não texto corrido.
 */
export function extrairCabecalho(texto: string): { nomePrincipal?: CampoExtraido<string>; matricula?: CampoExtraido<string> } {
  const linhas = texto.split("\n").map((l) => l.trim()).filter(Boolean)
  const out: { nomePrincipal?: CampoExtraido<string>; matricula?: CampoExtraido<string> } = {}
  for (let i = 0; i < linhas.length - 1; i++) {
    const rotulo = semAcento(linhas[i]).toLowerCase()
    if (rotulo === "nome" && !out.nomePrincipal) {
      out.nomePrincipal = { valor: tituloCase(linhas[i + 1]), origem: `${linhas[i]}\n${linhas[i + 1]}` }
    }
    if (rotulo === "matricula" && !out.matricula) {
      out.matricula = { valor: linhas[i + 1].replace(/\s+/g, " ").trim(), origem: `${linhas[i]}\n${linhas[i + 1]}` }
    }
  }
  return out
}

/**
 * Casa `regex` (escrito em minúsculas e SEM acento — "legitimo", não "legítimo")
 * contra uma versão normalizada do texto, e devolve os grupos capturados RECORTADOS
 * DO TEXTO ORIGINAL — preserva acentuação e maiúsculas do nome de verdade.
 *
 * Funciona porque tirar acento nunca muda o comprimento em caracteres pra letras
 * latinas (uma letra acentuada em NFC é 1 char; NFD decompõe em base+combinação, e
 * remover a combinação devolve a base — ainda 1 char). Os índices de onde cada grupo
 * casou no texto normalizado continuam válidos no texto original, char por char.
 */
function casarNormalizado(
  textoOriginal: string,
  regex: RegExp,
): { grupos: string[]; textoCompleto: string } | null {
  const original = textoOriginal.replace(/\s+/g, " ")
  const norm = semAcento(original).toLowerCase()
  const flags = regex.flags.includes("d") ? regex.flags : regex.flags + "d"
  const re = new RegExp(regex.source, flags)
  const m = re.exec(norm) as (RegExpExecArray & { indices?: Array<[number, number] | undefined> }) | null
  if (!m || !m.indices) return null
  const grupos = m.indices.slice(1).map((idx) => (idx ? original.slice(idx[0], idx[1]) : ""))
  const [ini, fim] = m.indices[0]!
  return { grupos, textoCompleto: original.slice(ini, fim) }
}

/** Mesma técnica de `casarNormalizado`, mas devolve TODAS as ocorrências, em ordem. */
function casarTodosNormalizados(
  textoOriginal: string,
  regex: RegExp,
): Array<{ grupos: string[]; textoCompleto: string }> {
  const original = textoOriginal.replace(/\s+/g, " ")
  const norm = semAcento(original).toLowerCase()
  const flagsBase = regex.flags.includes("d") ? regex.flags : regex.flags + "d"
  const flags = flagsBase.includes("g") ? flagsBase : flagsBase + "g"
  const re = new RegExp(regex.source, flags)
  const out: Array<{ grupos: string[]; textoCompleto: string }> = []
  for (const m of norm.matchAll(re)) {
    const mi = m as RegExpMatchArray & { indices?: Array<[number, number] | undefined> }
    if (!mi.indices) continue
    const grupos = mi.indices.slice(1).map((idx) => (idx ? original.slice(idx[0], idx[1]) : ""))
    const [ini, fim] = mi.indices[0]!
    out.push({ grupos, textoCompleto: original.slice(ini, fim) })
  }
  return out
}

const PADRAO_FILIACAO =
  /filh[oa]s?\s+legitim[oa]s?\s+de\s+([a-z'.\s]+?)\s+e\s+(?:de\s+)?(?:sua\s+esposa\s+|dona\s+|d\.\s+)?([a-z'.\s]+?)(?:[,.;]|\s+ambos\b|\s+natural|\s+residente|\s+domicil|$)/

/**
 * TODAS as filiações do texto, em ordem de aparição — usado no casamento, onde o
 * boilerplate cita "filho legítimo de X e de Y" do noivo e depois "filha legítima
 * de X e de Y" da noiva, nessa ordem. Sem um jeito melhor de amarrar cada trecho a
 * um nubente específico, a ORDEM é o único sinal confiável — e é sempre essa,
 * porque o texto sempre apresenta o noivo primeiro.
 */
export function extrairTodasFiliacoes(texto: string): Array<{ pai: CampoExtraido<string>; mae: CampoExtraido<string> }> {
  return casarTodosNormalizados(texto, PADRAO_FILIACAO).map((r) => ({
    pai: { valor: tituloCase(r.grupos[0]), origem: r.textoCompleto },
    mae: { valor: tituloCase(r.grupos[1]), origem: r.textoCompleto },
  }))
}

/**
 * "filho(a) legítimo(a) de PAI e de [dona] MÃE" — filiação, boilerplate padrão do
 * Registro Civil brasileiro. Devolve nulo pros dois lados se a âncora não bater
 * inteira (não arrisca achar só metade e inventar o resto).
 */
export function extrairFiliacao(texto: string): { pai?: CampoExtraido<string>; mae?: CampoExtraido<string> } {
  const r = casarNormalizado(texto, PADRAO_FILIACAO)
  if (!r) return {}
  return {
    pai: { valor: tituloCase(r.grupos[0]), origem: r.textoCompleto },
    mae: { valor: tituloCase(r.grupos[1]), origem: r.textoCompleto },
  }
}

/**
 * "sendo avós paternos AVÔ e AVÓ" [e maternos AVÔ e AVÓ] — só presente em nascimento
 * (nem toda certidão registra; ausência de âncora é normal, não é falha).
 */
export function extrairAvos(texto: string): {
  avoPaterno?: CampoExtraido<string>; avoPaterna?: CampoExtraido<string>
  avoMaterno?: CampoExtraido<string>; avoMaterna?: CampoExtraido<string>
} {
  const out: ReturnType<typeof extrairAvos> = {}
  const rp = casarNormalizado(texto, /av[oó]s\s+paternos\s+([a-z'.\s]+?)\s+e\s+([a-z'.\s]+?)(?:[,.;]|\s+e\s+matern|\s+falecid|\s+ambos|$)/)
  if (rp) {
    out.avoPaterno = { valor: tituloCase(rp.grupos[0]), origem: rp.textoCompleto }
    out.avoPaterna = { valor: tituloCase(rp.grupos[1]), origem: rp.textoCompleto }
  }
  const rm = casarNormalizado(texto, /matern[oa]s\s+([a-z'.\s]+?)\s+e\s+([a-z'.\s]+?)(?:[,.;]|\s+falecid|\s+ambos|$)/)
  if (rm) {
    out.avoMaterno = { valor: tituloCase(rm.grupos[0]), origem: rm.textoCompleto }
    out.avoMaterna = { valor: tituloCase(rm.grupos[1]), origem: rm.textoCompleto }
  }
  return out
}

/** "natural de LOCAL" / "natural desta cidade" (resolve pelo município do próprio registro). */
export function extrairNaturalidade(texto: string, municipioDoRegistro?: string): Extraido<string> {
  const rDeste = casarNormalizado(texto, /natural\s+de(?:ste|sta)\s+(?:estado|cidade|municipio)\b/)
  if (rDeste && municipioDoRegistro) return { valor: municipioDoRegistro, origem: rDeste.textoCompleto }
  const r = casarNormalizado(texto, /natural\s+de\s+([a-z'.\s,]+?)(?:[,.;]|\s+residente|\s+domicil|\s+com\s+\d|\s+e\s+de\s+profiss|$)/)
  if (!r) return undefined
  return { valor: tituloCase(r.grupos[0]), origem: r.textoCompleto }
}

/** Data por extenso mais próxima do início do texto — é onde o ato registra o evento. */
export function extrairDataDoEvento(texto: string): Extraido<string> {
  const data = extrairDataPorExtenso(texto)
  return data ? { valor: data, origem: "" } : undefined
}

export function extrairIdade(texto: string): Extraido<number> {
  const idade = extrairIdadeDeclarada(texto)
  return idade != null ? { valor: idade, origem: "" } : undefined
}

/**
 * "nesta cidade de LOCAL" / "nesta capital do Estado de LOCAL" / "neste município
 * de LOCAL" — é o município ONDE O ATO FOI LAVRADO, sempre citado logo depois da
 * data por extenso no boilerplate do Registro Civil. Pra casamento e óbito, esse
 * É o local do evento (o casamento/óbito acontece na comarca do cartório que
 * registra); pra nascimento, `extrairNaturalidade` já cobre com fonte melhor
 * ("natural de X", que é do PRÓPRIO registrado, não do cartório).
 */
export function extrairLocalDoRegistro(texto: string): Extraido<string> {
  const r = casarNormalizado(
    texto,
    /nest[ae]\s+(?:cidade|capital(?:\s+do\s+estado)?|municipio|comarca)\s+de\s+([a-z'.\s]+?)(?:[,.]|\s+no\s+tribunal|\s+capital|\s+as\s+\d|\s+às\s+\d|$)/,
  )
  if (!r) return undefined
  return { valor: tituloCase(r.grupos[0]), origem: r.textoCompleto }
}

// Nacionalidades citadas por extenso em certidão brasileira — vocabulário FECHADO
// (mesmo espírito do extenso-pt.ts): só reconhece o que está nesta lista, nunca
// adivinha por outro sinal (não infere "brasileiro" só por "natural deste
// Estado" — são perguntas diferentes, e conflar as duas já foi engano nesta
// sessão: "linha direta" ≠ "tem número", mesma lição, campo diferente).
const NACIONALIDADES: Record<string, string> = {
  brasileiro: "Brasileira", brasileira: "Brasileira",
  italiano: "Italiana", italiana: "Italiana",
  espanhol: "Espanhola", espanhola: "Espanhola",
  portugues: "Portuguesa", portuguesa: "Portuguesa",
  alemao: "Alemã", alema: "Alemã",
  argentino: "Argentina", argentina: "Argentina",
  uruguaio: "Uruguaia", uruguaia: "Uruguaia",
}
/** "natural da Italia" já dá nacionalidade pela âncora de naturalidade; isto cobre quando ela vem como PALAVRA solta ("brasileiro", "italiana") — nunca inferida. */
export function extrairNacionalidade(texto: string): Extraido<string> {
  const norm = semAcento(texto).toLowerCase()
  for (const [chave, rotulo] of Object.entries(NACIONALIDADES)) {
    const re = new RegExp(`\\b${chave}\\b`)
    if (re.test(norm)) return { valor: rotulo, origem: chave }
  }
  return undefined
}

// ============================================================
// MONTAGEM POR TIPO — devolve o shape que ad-v2-engine.ts espera em structuredData
// ============================================================

const val = <T>(c: Extraido<T>): T | undefined => c?.valor

export function extrairNascimento(texto: string, municipioDoRegistro?: string) {
  const cab = extrairCabecalho(texto)
  const fil = extrairFiliacao(texto)
  const avos = extrairAvos(texto)
  return {
    registered: {
      fullName: val(cab.nomePrincipal),
      birthDate: val(extrairDataDoEvento(texto)),
      birthPlace: val(extrairNaturalidade(texto, municipioDoRegistro)),
      nationality: val(extrairNacionalidade(texto)),
    },
    father: { fullName: val(fil.pai) },
    mother: { fullName: val(fil.mae) },
    paternalGrandparents: { grandfatherName: val(avos.avoPaterno), grandmotherName: val(avos.avoPaterna) },
    maternalGrandparents: { grandfatherName: val(avos.avoMaterno), grandmotherName: val(avos.avoMaterna) },
  }
}

export function extrairObito(texto: string, municipioDoRegistro?: string) {
  const cab = extrairCabecalho(texto)
  const fil = extrairFiliacao(texto)
  return {
    deceased: {
      fullName: val(cab.nomePrincipal),
      birthPlace: val(extrairNaturalidade(texto, municipioDoRegistro)),
      nationality: val(extrairNacionalidade(texto)),
      declaredAge: val(extrairIdade(texto)),
    },
    parents: { fatherFullName: val(fil.pai), motherFullName: val(fil.mae) },
    deathEvent: { deathDate: val(extrairDataDoEvento(texto)), deathPlace: val(extrairLocalDoRegistro(texto)) },
  }
}

/**
 * Casamento tem DOIS nubentes na mesma certidão — o cabeçalho estruturado lista os
 * dois ("NOME ATUAL DOS CÔNJUGES"), e a filiação narrativa aparece DUAS vezes no
 * texto corrido: primeiro a do noivo, depois a da noiva — o boilerplate do
 * Registro Civil sempre apresenta nessa ordem. `extrairTodasFiliacoes` devolve as
 * ocorrências na ordem em que aparecem; a posição 0 é do noivo, a 1 é da noiva.
 * Sem correspondência nenhuma (0 ocorrências), o campo fica vazio — não inventa.
 *
 * DELIBERADAMENTE NÃO extraído: idade declarada de cada nubente. No texto real
 * usado nesta sessão, "com trinta e nove annos de idade" aparece logo depois do
 * nome da MÃE da noiva, não da noiva — um padrão "X anos de idade" ingênuo
 * atribuiria a idade da mãe à filha. Sem um jeito confiável de saber de quem é a
 * idade só pelo texto corrido, fica de fora — errar a pessoa é pior que não
 * preencher.
 */
// Rótulos que aparecem no mesmo bloco do cabeçalho e NUNCA são nome de pessoa —
// sem esta lista, "NÃO CONSTA"/"MATRICULA"/um número solto de CPF passavam no
// teste de "parece nome" (letras, 2+ palavras) e viravam nome de cônjuge.
const RUIDO_CABECALHO_CASAMENTO = [
  "nao consta", "numero do cpf", "matricula", "certifico", "nome atual", "conjuges",
]
/** Linha plausível de ser um NOME de pessoa: só letras/espaço/apóstrofo, 2 a 6 palavras, sem ruído de rótulo. */
function pareceNomeDePessoa(linha: string): boolean {
  const norm = semAcento(linha).toLowerCase().trim()
  if (RUIDO_CABECALHO_CASAMENTO.some((r) => norm.includes(r))) return false
  if (!/^[a-z'.]+(?:\s+[a-z'.]+){1,5}$/.test(norm)) return false
  return norm.length >= 6 && norm.length <= 60
}

export function extrairCasamento(texto: string) {
  const linhas = texto.split("\n").map((l) => l.trim()).filter(Boolean)
  const nomes: string[] = []
  for (let i = 0; i < linhas.length - 1; i++) {
    if (semAcento(linhas[i]).toLowerCase().includes("nome atual dos conjuges") || semAcento(linhas[i]).toLowerCase() === "nome") {
      for (let j = i + 1; j < linhas.length && nomes.length < 2; j++) {
        if (pareceNomeDePessoa(linhas[j])) nomes.push(tituloCase(linhas[j]))
      }
      break
    }
  }
  const filiacoes = extrairTodasFiliacoes(texto)
  return {
    spouse1: { fullName: nomes[0] },
    spouse2: { fullName: nomes[1] },
    spouse1Parents: { fatherFullName: val(filiacoes[0]?.pai), motherFullName: val(filiacoes[0]?.mae) },
    spouse2Parents: { fatherFullName: val(filiacoes[1]?.pai), motherFullName: val(filiacoes[1]?.mae) },
    event: { marriageDate: val(extrairDataDoEvento(texto)), marriagePlace: val(extrairLocalDoRegistro(texto)) },
  }
}
