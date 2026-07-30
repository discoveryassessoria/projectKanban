// src/lib/genealogia/registral/normalizacao.ts
//
// MRG — normalização registral. Puro.
//
// Certidão histórica não escreve data em ISO: escreve "aos vinte e cinco dias do
// mês de janeiro do ano de mil novecentos e vinte e três". Nome não vem
// padronizado: vem "Ma. Jozé da Silva", "MARIA JOSE DA SYLVA", "Maria José
// Silva de Oliveira" (nome de casada). Localidade vem com o cartório colado.
//
// Este módulo transforma esse texto em valor comparável SEM decidir nada: ele
// normaliza, não conclui. Quem conclui é o conferidor e o motor de identidade.
//
// Reusa `motor/texto.ts` (normalizar, chaveFonetica, similaridade) — não
// reimplementa nenhuma distância: escala divergente entre módulos é como o mesmo
// par de nomes passa a ter dois vereditos.

import { chaveFonetica, normalizar, tokensNome } from "@/src/lib/genealogia/motor/texto"

// ---------------------------------------------------------------- posição

export interface TextoAlinhado {
  /** Texto normalizado (maiúsculas, sem acento, pontuação virou espaço). */
  norm: string
  /** mapa[i] = índice, no texto ORIGINAL, do caractere que gerou norm[i]. */
  mapa: number[]
}

/**
 * Normaliza PRESERVANDO A POSIÇÃO.
 *
 * Por que existe: `normalizar()` colapsa espaços e remove acentos via NFD, então
 * o texto normalizado tem comprimento DIFERENTE do original. Usar um offset
 * calculado no normalizado para cortar o original produz valor deslocado — foi
 * exatamente o defeito que este mapa elimina. Com ele, cada posição do texto
 * normalizado sabe de onde veio, e a evidência pode citar offset REAL do
 * documento e recortar o trecho REAL.
 */
export function normalizarComMapa(texto: string): TextoAlinhado {
  let norm = ""
  const mapa: number[] = []
  let ultimoFoiEspaco = true // evita espaço inicial

  for (let i = 0; i < texto.length; i++) {
    const bruto = texto[i]
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toUpperCase()
    for (const ch of bruto) {
      const limpo = /[A-Z0-9]/.test(ch) ? ch : " "
      if (limpo === " ") {
        if (ultimoFoiEspaco) continue
        ultimoFoiEspaco = true
      } else {
        ultimoFoiEspaco = false
      }
      norm += limpo
      mapa.push(i)
    }
  }
  // remove espaço final sem perder o alinhamento
  while (norm.endsWith(" ")) {
    norm = norm.slice(0, -1)
    mapa.pop()
  }
  return { norm, mapa }
}

// ---------------------------------------------------------------- datas

const MESES: Record<string, number> = {
  JANEIRO: 1, JANEIRO_ABREV: 1, JAN: 1, GENNAIO: 1, ENERO: 1,
  FEVEREIRO: 2, FEV: 2, FEBBRAIO: 2, FEBRERO: 2,
  MARCO: 3, MAR: 3, MARZO: 3,
  ABRIL: 4, ABR: 4, APRILE: 4,
  MAIO: 5, MAI: 5, MAGGIO: 5, MAYO: 5,
  JUNHO: 6, JUN: 6, GIUGNO: 6, JUNIO: 6,
  JULHO: 7, JUL: 7, LUGLIO: 7, JULIO: 7,
  AGOSTO: 8, AGO: 8, AGOSTO_IT: 8,
  SETEMBRO: 9, SET: 9, SETTEMBRE: 9, SEPTIEMBRE: 9,
  OUTUBRO: 10, OUT: 10, OTTOBRE: 10, OCTUBRE: 10,
  NOVEMBRO: 11, NOV: 11, NOVEMBRE: 11, NOVIEMBRE: 11,
  DEZEMBRO: 12, DEZ: 12, DICEMBRE: 12, DICIEMBRE: 12,
}

/** Numerais escritos — o que aparece em livro de registro antigo. */
const UNIDADES: Record<string, number> = {
  ZERO: 0, UM: 1, UMA: 1, PRIMEIRO: 1, DOIS: 2, DUAS: 2, TRES: 3, QUATRO: 4,
  CINCO: 5, SEIS: 6, SETE: 7, OITO: 8, NOVE: 9, DEZ: 10, ONZE: 11, DOZE: 12,
  TREZE: 13, QUATORZE: 14, CATORZE: 14, QUINZE: 15, DEZESSEIS: 16, DEZASSEIS: 16,
  DEZESSETE: 17, DEZASSETE: 17, DEZOITO: 18, DEZENOVE: 19, DEZANOVE: 19,
  VINTE: 20, TRINTA: 30, QUARENTA: 40, CINQUENTA: 50, SESSENTA: 60,
  SETENTA: 70, OITENTA: 80, NOVENTA: 90,
  CEM: 100, CENTO: 100, DUZENTOS: 200, TREZENTOS: 300, QUATROCENTOS: 400,
  QUINHENTOS: 500, SEISCENTOS: 600, SETECENTOS: 700, OITOCENTOS: 800, NOVECENTOS: 900,
  MIL: 1000,
}

/**
 * Converte numeral escrito em português para inteiro.
 * "mil novecentos e vinte e tres" -> 1923; "vinte e cinco" -> 25.
 * Devolve null quando nenhum token numérico é reconhecido.
 */
export function numeralEscritoParaInteiro(texto: string): number | null {
  const tokens = normalizar(texto).split(" ").filter((t) => t && t !== "E")
  if (!tokens.length) return null

  let total = 0
  let parcial = 0
  let achou = false

  for (const t of tokens) {
    const v = UNIDADES[t]
    if (v == null) continue
    achou = true
    if (v === 1000) {
      total += (parcial === 0 ? 1 : parcial) * 1000
      parcial = 0
    } else {
      parcial += v
    }
  }
  if (!achou) return null
  return total + parcial
}

export interface DataNormalizada {
  /** ISO yyyy-mm-dd. */
  iso: string
  ano: number
  mes: number
  dia: number
  /** Precisão real do que o documento diz. */
  precisao: "dia" | "mes" | "ano"
  metodo: string
}

const RE_ISO = /(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/
const RE_DMY = /(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/
const RE_DIA_MES_ANO_TEXTO =
  /(\d{1,2})\s*(?:de|d[eo]s?)?\s*([a-zçãáéíóúêôâü]{3,12})\s*(?:de|d[eo]s?)?\s*(\d{4})/i

/**
 * Normaliza data em qualquer forma que apareça numa certidão.
 * Ordem: ISO > dd/mm/aaaa > "12 de janeiro de 1923" > forma inteiramente
 * escrita ("aos vinte dias do mes de janeiro de mil novecentos e vinte").
 */
export function normalizarData(bruto: string | null | undefined): DataNormalizada | null {
  if (!bruto) return null
  const cru = String(bruto).trim()
  if (!cru) return null

  const iso = cru.match(RE_ISO)
  if (iso) return montar(+iso[1], +iso[2], +iso[3], "dia", "iso")

  const dmy = cru.match(RE_DMY)
  if (dmy) {
    let ano = +dmy[3]
    if (ano < 100) ano += ano <= 30 ? 2000 : 1900
    return montar(ano, +dmy[2], +dmy[1], "dia", "dmy")
  }

  const misto = cru.match(RE_DIA_MES_ANO_TEXTO)
  if (misto) {
    const mes = mesDeTexto(misto[2])
    if (mes) return montar(+misto[3], mes, +misto[1], "dia", "dia-mes-texto")
  }

  // Forma inteiramente escrita. Estratégia: localizar o nome do mês, converter o
  // que vem antes (dia) e o que vem depois (ano) separadamente.
  const norm = normalizar(cru)
  const palavras = norm.split(" ")
  let idxMes = -1
  let mesNum = 0
  for (let i = 0; i < palavras.length; i++) {
    const m = mesDeTexto(palavras[i])
    if (m) {
      idxMes = i
      mesNum = m
      break
    }
  }
  if (idxMes >= 0) {
    const antes = palavras.slice(0, idxMes).join(" ")
    const depois = palavras.slice(idxMes + 1).join(" ")
    const diaNum = extrairInteiro(antes, 1, 31)
    const anoNum = extrairInteiro(depois, 1000, 2200)
    if (anoNum != null && diaNum != null) {
      return montar(anoNum, mesNum, diaNum, "dia", "numeral-escrito")
    }
    if (anoNum != null) return montar(anoNum, mesNum, 1, "mes", "numeral-escrito-mes")
  }

  // Só o ano (comum em registro paroquial danificado).
  const soAno = norm.match(/\b(1[5-9]\d{2}|20\d{2})\b/)
  if (soAno) return montar(+soAno[1], 1, 1, "ano", "ano-isolado")

  const escrito = numeralEscritoParaInteiro(norm)
  if (escrito != null && escrito >= 1500 && escrito <= 2200) {
    return montar(escrito, 1, 1, "ano", "numeral-escrito-ano")
  }

  return null
}

function extrairInteiro(texto: string, min: number, max: number): number | null {
  const dig = texto.match(/\b(\d{1,4})\b/)
  if (dig) {
    const v = +dig[1]
    if (v >= min && v <= max) return v
  }
  const esc = numeralEscritoParaInteiro(texto)
  if (esc != null && esc >= min && esc <= max) return esc
  return null
}

function mesDeTexto(t: string): number | null {
  const n = normalizar(t)
  if (!n) return null
  // ARMADILHA REAL, encontrada lendo certidão de verdade: a regra de abreviação
  // por 3 letras faz o NUMERAL virar mês. "dez" (10) casa com dezembro, "sete"
  // com setembro e "nove" com novembro — e são exatamente os dias 7, 9 e 10, os
  // mais escritos por extenso no assento brasileiro ("aos dez dias do mês de
  // maio..."). O efeito era silencioso e pior que um erro: a segunda leitura
  // devolvia dezembro, a primeira devolvia maio, e o campo travava como
  // divergente — uma discordância inventada pelo normalizador, não pelo
  // documento. Numeral escrito nunca é abreviação de mês.
  if (UNIDADES[n] != null) return null

  if (MESES[n] != null) return MESES[n]

  // prefixo de 3 letras cobre abreviações com ponto ("jan.", "fev.")
  const abrev = n.slice(0, 3)
  for (const [k, v] of Object.entries(MESES)) {
    if (k.startsWith(abrev) && abrev.length === 3) return v
  }
  return null
}

function montar(
  ano: number,
  mes: number,
  dia: number,
  precisao: "dia" | "mes" | "ano",
  metodo: string,
): DataNormalizada | null {
  if (!Number.isFinite(ano) || ano < 1400 || ano > 2200) return null
  if (mes < 1 || mes > 12) return null
  if (dia < 1 || dia > 31) return null
  // Rejeita data inexistente (31/02) em vez de "corrigir" silenciosamente.
  const d = new Date(Date.UTC(ano, mes - 1, dia, 12))
  if (d.getUTCMonth() !== mes - 1 || d.getUTCDate() !== dia) return null
  const iso = `${String(ano).padStart(4, "0")}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`
  return { iso, ano, mes, dia, precisao, metodo }
}

// ---------------------------------------------------------------- nomes

/** Abreviações que aparecem em registro civil brasileiro e paroquial. */
const EXPANSOES: Array<[RegExp, string]> = [
  [/\bMA\.?\b/g, "MARIA"],
  [/\bM\.?\s*A\.?\b/g, "MARIA"],
  [/\bJO\.?\b/g, "JOAO"],
  [/\bJOZE\b/g, "JOSE"],
  [/\bJOZEFA\b/g, "JOSEFA"],
  [/\bANTO\.?\b/g, "ANTONIO"],
  [/\bANT\.?\b/g, "ANTONIO"],
  [/\bFCO\.?\b/g, "FRANCISCO"],
  [/\bFRCO\.?\b/g, "FRANCISCO"],
  [/\bMANL\.?\b/g, "MANUEL"],
  [/\bMANOEL\b/g, "MANUEL"],
  [/\bGUILH\.?\b/g, "GUILHERME"],
  [/\bSEB\.?\b/g, "SEBASTIAO"],
  [/\bTHEREZA\b/g, "TERESA"],
  [/\bTHEREsA\b/gi, "TERESA"],
  [/\bLUIZ\b/g, "LUIS"],
]

export interface NomeNormalizado {
  /** Forma normalizada completa (maiúsculas, sem acento, abreviação expandida). */
  completo: string
  /** Primeiro nome (prenome). */
  prenome: string
  /** Sobrenome provável (último token significativo + partícula). */
  sobrenome: string
  tokens: string[]
  chaveFonetica: string
  /** true quando o bruto continha abreviação expandida — reduz confiança. */
  expandido: boolean
}

/** Normaliza nome próprio de documento, expandindo abreviações históricas. */
export function normalizarNome(bruto: string | null | undefined): NomeNormalizado | null {
  if (!bruto) return null
  let n = normalizar(bruto)
  if (!n) return null

  // Remove ruído de rótulo que o OCR costuma colar no valor.
  n = n
    .replace(/\b(FILHO|FILHA)\s+DE\b/g, " ")
    .replace(/\b(SR|SRA|DOM|DONA|D)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim()

  const antes = n
  for (const [re, sub] of EXPANSOES) n = n.replace(re, sub)
  const expandido = n !== antes

  const tokens = tokensNome(n)
  if (!tokens.length) return null

  return {
    completo: n,
    prenome: tokens[0],
    sobrenome: sobrenomeDe(n),
    tokens,
    chaveFonetica: chaveFonetica(sobrenomeDe(n) || tokens[0]),
    expandido,
  }
}

const PARTICULAS_SOBRENOME = new Set([
  "DE", "DA", "DO", "DAS", "DOS", "DI", "DEL", "DELLA", "DELLE", "DEI", "DEGLI",
  "LA", "LE", "LO", "LI", "VAN", "VON", "DER", "DEN", "Y",
])

/** Sobrenome com a partícula que o antecede ("DA SILVA", "DI GIOVANNI"). */
export function sobrenomeDe(nome: string | null | undefined): string {
  const partes = normalizar(nome).split(" ").filter(Boolean)
  if (!partes.length) return ""
  const ultimo = partes[partes.length - 1]
  if (partes.length === 1) return ultimo
  const penultimo = partes[partes.length - 2]
  if (PARTICULAS_SOBRENOME.has(penultimo)) {
    const antePenultimo = partes[partes.length - 3]
    if (antePenultimo && PARTICULAS_SOBRENOME.has(antePenultimo)) {
      return `${antePenultimo} ${penultimo} ${ultimo}`
    }
    return `${penultimo} ${ultimo}`
  }
  return ultimo
}

/** Prenome (tudo antes do sobrenome). */
export function prenomeDe(nome: string | null | undefined): string {
  const completo = normalizar(nome)
  const sob = sobrenomeDe(completo)
  if (!sob) return completo
  return completo.slice(0, completo.length - sob.length).trim()
}

/**
 * NOME DE CASADO — detecção estrutural, sem heurística de gênero.
 *
 * Regra registral: o nome de casada normalmente PRESERVA o prenome e ACRESCENTA
 * (ou substitui) o sobrenome pelo do cônjuge. Então "Maria Souza" e "Maria Souza
 * Bianchi" são a mesma pessoa se "Bianchi" é o sobrenome do cônjuge.
 *
 * Esta função NÃO afirma identidade: devolve se a relação estrutural existe, e o
 * motor de identidade usa isso como UMA evidência entre várias.
 */
export function ehVariacaoDeCasamento(
  nomeSolteiro: string | null | undefined,
  nomeCasado: string | null | undefined,
  sobrenomeConjuge?: string | null,
): { compativel: boolean; motivo: string } {
  const a = normalizarNome(nomeSolteiro)
  const b = normalizarNome(nomeCasado)
  if (!a || !b) return { compativel: false, motivo: "Um dos nomes está vazio." }

  if (a.prenome !== b.prenome) {
    // prenome pode ter grafia diferente — compara fonética do prenome
    if (chaveFonetica(a.prenome) !== chaveFonetica(b.prenome)) {
      return { compativel: false, motivo: "Prenomes diferentes: não é variação de casamento." }
    }
  }

  const setA = new Set(a.tokens)
  const setB = new Set(b.tokens)
  const soEmB = [...setB].filter((t) => !setA.has(t))
  const soEmA = [...setA].filter((t) => !setB.has(t))

  // Acréscimo puro de sobrenome (padrão mais comum).
  if (soEmA.length === 0 && soEmB.length > 0) {
    if (sobrenomeConjuge) {
      const kc = chaveFonetica(sobrenomeDe(sobrenomeConjuge))
      if (soEmB.some((t) => chaveFonetica(t) === kc)) {
        return {
          compativel: true,
          motivo: "Prenome preservado e sobrenome do cônjuge acrescentado.",
        }
      }
      return {
        compativel: false,
        motivo: "Sobrenome acrescentado não corresponde ao do cônjuge informado.",
      }
    }
    return { compativel: true, motivo: "Prenome preservado e sobrenome acrescentado." }
  }

  // Substituição de sobrenome pelo do cônjuge.
  if (sobrenomeConjuge && soEmB.length > 0) {
    const kc = chaveFonetica(sobrenomeDe(sobrenomeConjuge))
    if (soEmB.some((t) => chaveFonetica(t) === kc)) {
      return {
        compativel: true,
        motivo: "Sobrenome de solteira substituído pelo do cônjuge (prenome preservado).",
      }
    }
  }

  if (soEmA.length === 0 && soEmB.length === 0) {
    return { compativel: true, motivo: "Mesma composição de nome." }
  }

  return {
    compativel: false,
    motivo: "Composição de sobrenomes incompatível com variação de casamento.",
  }
}

// ---------------------------------------------------------------- localidades

/** Remove cartório/ofício/comarca colados na localidade. */
export function normalizarLocal(bruto: string | null | undefined): string {
  let n = normalizar(bruto)
  if (!n) return ""
  n = n
    .replace(
      /\b(\d+\s*[ºO]?\s*)?(OFICIO|OFICIAL|CARTORIO|TABELIONATO|REGISTRO CIVIL|RCPN|CRC|COMARCA|DISTRITO|SUBDISTRITO|PARO(Q|C)UIA|IGREJA|MATRIZ|SEDE)\b/g,
      " ",
    )
    .replace(
      /\b(ESTADO DE|ESTADO DO|PROVINCIA DE|PROVINCIA DI|COMUNE DI|MUNICIPIO DE|MUNICIPIO DO|CIDADE DE|CIDADE DO)\b/g,
      " ",
    )
    .replace(/\s+/g, " ")
    .trim()
  // Remover o rótulo deixa partículas órfãs no início ("DE DE BENTO GONCALVES").
  // Elas não fazem parte do nome do lugar: sem esta limpeza, duas grafias do mesmo
  // município deixam de comparar iguais.
  n = n.replace(/^(?:(?:DE|DO|DA|DOS|DAS|DI|D|IN|EM|NA|NO)\s+)+/g, "").trim()
  n = n.replace(/\s+(?:DE|DO|DA|DOS|DAS|DI)$/g, "").trim()
  return n
}

/** Idade declarada → inteiro (aceita "trinta e dois anos"). */
export function normalizarIdade(bruto: string | null | undefined): number | null {
  if (!bruto) return null
  const n = normalizar(bruto)
  const dig = n.match(/\b(\d{1,3})\b/)
  if (dig) {
    const v = +dig[1]
    if (v >= 0 && v <= 130) return v
  }
  const esc = numeralEscritoParaInteiro(n)
  if (esc != null && esc >= 0 && esc <= 130) return esc
  return null
}

/** Sexo inferido do PAPEL no documento — nunca do nome. */
export function sexoDoPapel(papel: string): string | null {
  switch (papel) {
    case "PAI":
    case "AVO_PATERNO":
    case "AVO_MATERNO":
    case "PADRINHO":
      return "M"
    case "MAE":
    case "AVOA_PATERNA":
    case "AVOA_MATERNA":
    case "MADRINHA":
      return "F"
    default:
      return null
  }
}

/**
 * Referência registral canônica: cartório/livro/folha/termo comparáveis.
 * Duas certidões com a mesma referência são a MESMA fonte — é o sinal mais forte
 * de que duas leituras falam do mesmo registro.
 */
export function referenciaRegistral(p: {
  cartorio?: string | null
  livro?: string | null
  folha?: string | null
  termo?: string | null
  numeroRegistro?: string | null
  matricula?: string | null
}): string {
  const partes = [
    normalizarLocal(p.cartorio),
    normalizar(p.livro).replace(/\s/g, ""),
    normalizar(p.folha).replace(/\s/g, ""),
    normalizar(p.termo).replace(/\s/g, ""),
    normalizar(p.matricula).replace(/\D/g, ""),
    normalizar(p.numeroRegistro).replace(/\s/g, ""),
  ].filter(Boolean)
  return partes.join("|")
}
