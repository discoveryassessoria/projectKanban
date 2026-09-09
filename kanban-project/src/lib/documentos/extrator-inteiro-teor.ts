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

import { extrairDataPorExtenso, extrairIdadeDeclarada, extensoParaNumero, MESES } from "./extenso-pt"

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
 * Ruído de margem (matrícula/número de página, lido de lado pelo OCR) que gruda
 * no meio de uma frase do corpo corrido — achado real (doc 2122, texto OCR de
 * verdade): "Antonio Medina de 70774\nOliveira", "no dia 7\nvinte e seis" — o
 * dígito nunca é conteúdo de verdade ali: nestas certidões o único dígito solto
 * que aparece por dentro do corpo é idade de testemunha ("39 anos"); data/idade
 * do(s) nubente(s)/registrado(s) é sempre por extenso. Troca por espaços do
 * MESMO tamanho (nunca remove caractere) pra não desalinhar os índices que
 * `casarNormalizado`/`casarTodosNormalizados` usam pra recortar do texto
 * original.
 */
function limparRuidoDeMargem(texto: string): string {
  let t = texto.replace(/\d{1,6}(?!\s*ann?os\b)/gi, (m) => " ".repeat(m.length))
  // Segundo padrão real, mesmo documento: letra maiúscula solta e/ou underscore
  // que o OCR gruda entre duas palavras da MESMA frase ("filha A\n_ legitima") —
  // nome de pessoa nunca aparece como letra solta no meio do boilerplate fixo do
  // registro civil; abreviação de verdade ("D.", "Dr.") sempre vem seguida de
  // ponto, por isso fica de fora daqui.
  t = t.replace(/\b[A-Z_]{1,2}\b(?!\.)/g, (m) => " ".repeat(m.length))
  // Terceiro padrão real, mesmo documento: ponto/traço solto colado no INÍCIO de
  // uma linha quebrada pelo OCR ("do Rio 7 VA\n. Grande do Sul") — pontuação de
  // verdade sempre gruda na palavra anterior sem espaço; um "." ou "-" com espaço
  // dos DOIS lados nunca é fim de frase de verdade, é artefato de margem.
  t = t.replace(/(?<=\s)[.-](?=\s)/g, " ")
  // Quarto padrão real (doc 2125 — muito mais ruidoso que o 2122): letra
  // MINÚSCULA solta grudada no fim/início de linha quebrada ("Oliveira i\n:
  // Funcionário") — só remove quando a letra isolada não é palavra de verdade;
  // "a"/"e"/"o" (e acentuadas) são artigo/conjunção reais, ficam de fora.
  const LETRA_ISOLADA_REAL = new Set(["a", "e", "o", "á", "à", "â", "ã", "é", "ê", "ó", "ô", "õ"])
  t = t.replace(/(?<=\s)([a-zà-ÿ])(?=\s)/g, (m) => (LETRA_ISOLADA_REAL.has(m) ? m : " "))
  // Mesmo espírito do "." /"-" isolado: dois-pontos solto com espaço dos dois
  // lados também é ruído de margem, nunca pontuação de verdade (que gruda na
  // palavra anterior sem espaço).
  t = t.replace(/(?<=\s):(?=\s)/g, " ")
  return t
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
// Achado real (doc 2125): o rótulo do formulário vem com letra solta de ruído
// grudada do lado ("o % NOME í") — exigir a linha INTEIRA igual a "nome" nunca
// bate num scan ruidoso. O rótulo é sempre uma linha curta (é rótulo de
// formulário, não frase) que CONTÉM a palavra inteira — isso já basta, mesmo
// com lixo grudado ao redor.
function linhaEhRotulo(linha: string, rotulo: string): boolean {
  const norm = semAcento(linha).toLowerCase()
  return norm.length <= 25 && new RegExp(`\\b${rotulo}\\b`).test(norm)
}
/** Só as palavras TODAS EM MAIÚSCULA da linha — é assim que o valor sai impresso na caixa do formulário; descarta ruído de OCR minúsculo/misto grudado do lado. */
function soMaiusculas(linha: string): string | null {
  const palavras = linha.split(/\s+/).filter((p) => p.length >= 2 && /^[A-ZÀ-Ú]+$/.test(p))
  return palavras.length ? palavras.join(" ") : null
}

export function extrairCabecalho(texto: string): { nomePrincipal?: CampoExtraido<string>; matricula?: CampoExtraido<string> } {
  const linhas = texto.split("\n").map((l) => l.trim()).filter(Boolean)
  const out: { nomePrincipal?: CampoExtraido<string>; matricula?: CampoExtraido<string> } = {}
  for (let i = 0; i < linhas.length - 1; i++) {
    if (linhaEhRotulo(linhas[i], "nome") && !out.nomePrincipal) {
      const valor = soMaiusculas(linhas[i + 1]) ?? linhas[i + 1]
      out.nomePrincipal = { valor: tituloCase(valor), origem: `${linhas[i]}\n${linhas[i + 1]}` }
    }
    if (linhaEhRotulo(linhas[i], "matricula") && !out.matricula) {
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
  /filh[oa]s?\s+legitim[oa]s?\s+de\s+([a-z'.\s]+?)(?:,\s*falecid[oa]s?)?\s+e\s+(?:de\s+)?(?:sua\s+esposa\s+|dona\s+|d\.\s+)?([a-z'.\s]+?)(?:[,.;]|\s+ambos\b|\s+natural|\s+residente|\s+domicil|$)/

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
 * Nomes dos NUBENTES pelo texto CORRIDO — "o senhor X e dona Y" — em vez do
 * cabeçalho em caixa com borda. Achado real (06/09/2026): o cabeçalho
 * "NOME ATUAL DOS CÔNJUGES" é uma caixa com borda, e o OCR lê essa região pior
 * que o parágrafo corrido (linha de borda se mistura com o texto, saída virava
 * "Ll Den"/"de Í À" — inútil pra revisão). O texto corrido, mesmo com o mesmo
 * OCR, leu limpo. Único ponto: o boilerplate deste tipo tem noivo primeiro.
 */
const PADRAO_NUBENTES_NARRATIVA =
  /(?:o\s+)?senhor\s+([a-z'.\s]+?)\s+e\s+(?:dona|sua\s+esposa)\s+([a-z'.\s]+?)(?:[,.;]|\s+ambos\b|\s+solteir|\s+casad|\s+natural|\s+residente|\s+domicil|$)/

export function extrairNubentesNarrativa(texto: string): { noivo?: CampoExtraido<string>; noiva?: CampoExtraido<string> } {
  const r = casarNormalizado(texto, PADRAO_NUBENTES_NARRATIVA)
  if (!r) return {}
  return {
    noivo: { valor: tituloCase(r.grupos[0]), origem: r.textoCompleto },
    noiva: { valor: tituloCase(r.grupos[1]), origem: r.textoCompleto },
  }
}

const PADRAO_NASCIMENTO_CONJUGE =
  /nasceu\s+em\s+([a-z'.\s]+?),?\s+no\s+dia\s+([a-z\s]+?)\s+de\s+(janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro),?\s+de\s+((?:mil|hum|um)[a-z\s]*?)(?:[,.;]|\s+filh|\s+domicil|\s+residente|$)/

/**
 * "nasceu em LOCAL, no dia DIA de MÊS[,] de ANO" — data e naturalidade de CADA
 * nubente, na ordem em que aparecem (noivo primeiro). É o mesmo boilerplate
 * que dá a data do REGISTRADO no nascimento, só que aqui narrado sobre um
 * terceiro (o nubente), dentro da certidão de casamento dele.
 */
export function extrairNascimentosDeConjuges(texto: string): Array<{ birthPlace?: CampoExtraido<string>; birthDate?: CampoExtraido<string> }> {
  return casarTodosNormalizados(texto, PADRAO_NASCIMENTO_CONJUGE).map((r) => {
    const [localRaw, diaRaw, mesNome, anoRaw] = r.grupos
    const dia = extensoParaNumero(diaRaw)
    // mesNome vem recortado do texto ORIGINAL (casarTodosNormalizados preserva
    // acento/maiúscula) — registro antigo escreve mês como substantivo próprio
    // ("de Julho"), então a chave de MESES (minúscula, sem acento) só bate depois
    // de normalizar aqui.
    const mes = MESES[semAcento(mesNome).toLowerCase()]
    const ano = extensoParaNumero(anoRaw)
    const dataValida = dia != null && !!mes && ano != null && dia >= 1 && dia <= 31 && ano >= 1800 && ano <= 2100
    return {
      birthPlace: localRaw ? { valor: tituloCase(localRaw), origem: r.textoCompleto } : undefined,
      birthDate: dataValida ? { valor: `${ano}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`, origem: r.textoCompleto } : undefined,
    }
  })
}

/**
 * "filho(a) legítimo(a) de PAI e de [dona] MÃE" — filiação, boilerplate padrão do
 * Registro Civil brasileiro. Devolve nulo pros dois lados se a âncora não bater
 * inteira (não arrisca achar só metade e inventar o resto).
 */
export function extrairFiliacao(texto: string): { pai?: CampoExtraido<string>; mae?: CampoExtraido<string> } {
  const r = casarNormalizado(texto, PADRAO_FILIACAO)
  if (r) {
    return {
      pai: { valor: tituloCase(r.grupos[0]), origem: r.textoCompleto },
      mae: { valor: tituloCase(r.grupos[1]), origem: r.textoCompleto },
    }
  }
  // Variante real de boilerplate (doc 2125): quando quem registra é o PRÓPRIO
  // pai, a certidão nunca escreve "filho legítimo de X e de Y" pro registrado —
  // só cita os pais uma vez, no início: "compareceu PAI, [profissão/estado
  // civil], casado [em LOCAL] com MÃE". Fallback só entra se o padrão principal
  // não bateu (documento pode legitimamente ter os dois padrões em partes
  // diferentes — o principal sempre ganha, por vir mais perto do nome do
  // registrado).
  return extrairPaisPeloDeclarante(texto)
}

const PADRAO_PAI_DECLARANTE =
  /compareceu\s+([a-z'.\s]+?)(?:[,.]|\s+funcionari|\s+comerciant|\s+domestic|\s+lavrador|\s+agricultor|\s+profiss[aã]o|\s+natural|\s+casad[oa]|\s+solteir)/
const PADRAO_MAE_DECLARANTE =
  /casad[oa]\s+(?:em\s+[a-z'.\s]+?\s+)?com\s+([a-z'.\s]+?)(?:[,.;]|\s+natura|\s+residente|\s+domicil|$)/

function extrairPaisPeloDeclarante(texto: string): { pai?: CampoExtraido<string>; mae?: CampoExtraido<string> } {
  const out: { pai?: CampoExtraido<string>; mae?: CampoExtraido<string> } = {}
  const pai = casarNormalizado(texto, PADRAO_PAI_DECLARANTE)
  if (pai) out.pai = { valor: tituloCase(pai.grupos[0]), origem: pai.textoCompleto }
  const mae = casarNormalizado(texto, PADRAO_MAE_DECLARANTE)
  if (mae) out.mae = { valor: tituloCase(mae.grupos[0]), origem: mae.textoCompleto }
  return out
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
  // "nesta cidade DE Porto Alegre" / "nesta cidade DO Rio Grande" — contração
  // muda com o nome do lugar (masculino/plural leva "do"), achado real (doc
  // 2125: "nesta cidade do Rio Grande") — as três formas são igual de comuns.
  const r = casarNormalizado(
    texto,
    /nest[ae]\s+(?:cidade|capital(?:\s+do\s+estado)?|municipio|comarca)\s+(?:de|do|da)\s+([a-z'.\s]+?)(?:[,.]|\s+no\s+tribunal|\s+capital|\s+as\s+\d|\s+às\s+\d|$)/,
  )
  if (!r) return undefined
  return { valor: tituloCase(r.grupos[0]), origem: r.textoCompleto }
}

/** "capital do Estado do/da X" — o Estado onde o ato foi lavrado, logo depois da cidade no mesmo boilerplate. */
export function extrairEstadoDoRegistro(texto: string): Extraido<string> {
  const r = casarNormalizado(texto, /estado\s+d[oa]\s+([a-z'.\s]+?)(?:[,.]|\s+no\s+tribunal|\s+as\s+\d|\s+às\s+\d|$)/)
  if (!r) return undefined
  return { valor: tituloCase(r.grupos[0]), origem: r.textoCompleto }
}

// ============================================================
// DADOS REGISTRAIS — referência administrativa do ato (matrícula/livro/folha/
// termo/cartório), DISTINTA dos dados genealógicos (nome/filiação/data de
// nascimento) que `extrairNascimento`/`extrairCasamento`/`extrairObito` já
// cobrem. Serve pra conferir o que foi DIGITADO no cadastro (Central
// Operacional: `Documento.livro/folha/termo/...`) contra o que o documento
// realmente diz — divergência aqui é erro de DIGITAÇÃO no nosso sistema, não
// erro do registro civil (nunca vira ponto de retificação judicial).
// ============================================================

/**
 * Matrícula (formato e-CRC, pós-2015): rótulo "MATRICULA" numa linha, e a
 * linha seguinte com a sequência de dígitos. Achado real (doc 2122): o rótulo
 * vem com ruído de OCR ao redor ("— MATRICULA E —"), por isso o critério é
 * CONTER "matricula", não ser exatamente igual — e o valor é reconhecido pela
 * densidade de dígitos da linha seguinte (matrícula real sempre tem muitos:
 * "099002 01 55 1937 2 00001 185 0000251 75"), não por regex de formato fixo
 * (variações de espaçamento entre cartórios).
 */
export function extrairNumeroRegistro(texto: string): Extraido<string> {
  const linhas = texto.split("\n").map((l) => l.trim()).filter(Boolean)
  for (let i = 0; i < linhas.length - 1; i++) {
    if (!semAcento(linhas[i]).toLowerCase().includes("matricula")) continue
    for (let j = i + 1; j < Math.min(i + 3, linhas.length); j++) {
      const digitos = linhas[j].replace(/[^0-9]/g, "")
      if (digitos.length >= 15) {
        // Só o MAIOR trecho contíguo de dígitos/espaço da linha — o rótulo
        // colado no início ("NE 100206...") e o ruído de OCR no fim
        // ("...0000251 75 A É") ficam de fora, não fazem parte do número.
        const candidatos = linhas[j].match(/[\d ]+/g) ?? [linhas[j]]
        const maior = candidatos.reduce((a, b) => (b.replace(/\D/g, "").length > a.replace(/\D/g, "").length ? b : a), "")
        const valor = maior.replace(/\s+/g, " ").trim()
        if (valor) return { valor, origem: `${linhas[i]}\n${linhas[j]}` }
      }
    }
  }
  return undefined
}

/**
 * "Livro nº X" / "fls. X" / "termo nº X" — formato de registro em livro físico
 * (certidões mais antigas, sem matrícula unificada). Sem exemplo real desta
 * árvore pra verificar (os documentos de teste são todos formato matrícula
 * e-CRC) — mantém o mesmo espírito de recorte literal, nunca inventa.
 */
export function extrairLivroFolhaTermo(texto: string): { livro?: Extraido<string>; folha?: Extraido<string>; termo?: Extraido<string> } {
  const out: ReturnType<typeof extrairLivroFolhaTermo> = {}
  // "termo" é palavra comum em português corrido ("nos termos da lei") — só conta
  // como campo administrativo quando o valor capturado tem dígito de verdade,
  // nunca uma palavra qualquer ("termo que" não é termo de registro nenhum).
  const temDigito = (s: string) => /\d/.test(s)
  const livro = casarNormalizado(texto, /livro\s*n?[ºo°]?\.?\s*([a-z0-9/-]+)/)
  if (livro && temDigito(livro.grupos[0])) out.livro = { valor: livro.grupos[0].toUpperCase(), origem: livro.textoCompleto }
  const folha = casarNormalizado(texto, /(?:folha|fls?\.)\s*n?[ºo°]?\.?\s*([a-z0-9/-]+)/)
  if (folha && temDigito(folha.grupos[0])) out.folha = { valor: folha.grupos[0].toUpperCase(), origem: folha.textoCompleto }
  const termo = casarNormalizado(texto, /termo\s*n?[ºo°]?\.?\s*([a-z0-9/-]+)/)
  if (termo && temDigito(termo.grupos[0])) out.termo = { valor: termo.grupos[0].toUpperCase(), origem: termo.textoCompleto }
  return out
}

export interface DadosRegistraisExtraidos {
  numeroRegistro?: Extraido<string>
  livro?: Extraido<string>
  folha?: Extraido<string>
  termo?: Extraido<string>
  cidadeRegistro?: Extraido<string>
  estadoRegistro?: Extraido<string>
  dataEvento?: Extraido<string>
}

/**
 * Junta toda a referência administrativa do ato num só lugar. Dois textos
 * diferentes de propósito: a matrícula (`numeroRegistro`) precisa do texto
 * ORIGINAL (o próprio dígito É o dado — `limparRuidoDeMargem` apagaria);
 * os campos narrativos (cidade/estado/data) precisam do texto LIMPO (o mesmo
 * ruído de margem que gruda entre palavras da frase corrida — achado real,
 * doc 2122: "Rio 7 VA\n. Grande do Sul" — quebraria "Rio Grande do Sul" do
 * mesmo jeito que quebrava nome/filiação antes do fix da sessão anterior).
 */
export function extrairDadosRegistrais(texto: string): DadosRegistraisExtraidos {
  const limpo = limparRuidoDeMargem(texto)
  const lft = extrairLivroFolhaTermo(limpo)
  return {
    numeroRegistro: extrairNumeroRegistro(texto),
    livro: lft.livro,
    folha: lft.folha,
    termo: lft.termo,
    cidadeRegistro: extrairLocalDoRegistro(limpo),
    estadoRegistro: extrairEstadoDoRegistro(limpo),
    dataEvento: extrairDataDoEvento(limpo),
  }
}

/** Mesma coisa que `extrairDadosRegistrais`, mas em valores planos — o shape que `Documento.registral` grava. */
export function extrairRegistral(texto: string): Record<string, string | undefined> {
  const d = extrairDadosRegistrais(texto)
  return {
    numeroRegistro: val(d.numeroRegistro),
    livro: val(d.livro),
    folha: val(d.folha),
    termo: val(d.termo),
    cidadeRegistro: val(d.cidadeRegistro),
    estadoRegistro: val(d.estadoRegistro),
    dataEvento: val(d.dataEvento),
  }
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

export const val = <T>(c: Extraido<T>): T | undefined => c?.valor

export function extrairNascimento(texto: string, municipioDoRegistro?: string) {
  texto = limparRuidoDeMargem(texto)
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
  texto = limparRuidoDeMargem(texto)
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
  texto = limparRuidoDeMargem(texto)
  // Nome pelo texto CORRIDO primeiro (mais confiável — ver PADRAO_NUBENTES_NARRATIVA);
  // cabeçalho em caixa só como fallback se a narrativa não bater.
  const narrativa = extrairNubentesNarrativa(texto)
  let nomeNoivo = val(narrativa.noivo)
  let nomeNoiva = val(narrativa.noiva)
  if (!nomeNoivo || !nomeNoiva) {
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
    nomeNoivo = nomeNoivo || nomes[0]
    nomeNoiva = nomeNoiva || nomes[1]
  }

  const filiacoes = extrairTodasFiliacoes(texto)
  const nascimentos = extrairNascimentosDeConjuges(texto)
  return {
    spouse1: { fullName: nomeNoivo, birthDate: val(nascimentos[0]?.birthDate), birthPlace: val(nascimentos[0]?.birthPlace) },
    spouse2: { fullName: nomeNoiva, birthDate: val(nascimentos[1]?.birthDate), birthPlace: val(nascimentos[1]?.birthPlace) },
    spouse1Parents: { fatherFullName: val(filiacoes[0]?.pai), motherFullName: val(filiacoes[0]?.mae) },
    spouse2Parents: { fatherFullName: val(filiacoes[1]?.pai), motherFullName: val(filiacoes[1]?.mae) },
    event: { marriageDate: val(extrairDataDoEvento(texto)), marriagePlace: val(extrairLocalDoRegistro(texto)) },
  }
}
