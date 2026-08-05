// src/lib/documentos/modelos/docx.ts
//
// MOTOR DOCX — leitura, substituição e extração estrutural do OOXML.
//
// O texto jurídico nunca sai daqui para o código: este módulo não conhece uma
// única palavra dos modelos. Ele sabe abrir o pacote, encontrar placeholders,
// trocá-los por valores e devolver a estrutura do documento — nada mais.
//
// O PROBLEMA DOS RUNS
// -------------------
// O Word quebra uma frase em vários `<w:r>` por motivos de revisão, corretor e
// formatação. Um `{{PLACEHOLDER}}` digitado no Word pode acabar repartido em
// três runs. Substituir `<w:t>` por `<w:t>` isoladamente falharia justamente nos
// templates que um humano preparou. Por isso a substituição acontece no TEXTO
// CONCATENADO do parágrafo, e o resultado é escrito de volta no PRIMEIRO run
// atingido — que é o que preserva a formatação pretendida (o nome em negrito
// continua no run em negrito).

import JSZip from "jszip"
import { regraDeRenderizacao, valorRenderizado } from "./variaveis"

/**
 * Data fixa das entradas do ZIP.
 *
 * Sem ela, dois pacotes com o MESMO conteúdo teriam checksums diferentes: ao
 * reescrever uma parte, o JSZip carimba a hora ATUAL na entrada, e o carimbo
 * entra no binário. Com a data fixa, o checksum passa a depender só do conteúdo
 * — que é o que faz a impressão digital provar identidade, e o que faz a
 * idempotência da geração reconhecer o mesmo documento.
 */
const OPCOES_DE_ENTRADA = { date: new Date(0) }

/** Partes do pacote que carregam texto visível — corpo, cabeçalhos e rodapés. */
const PARTES_COM_TEXTO = /^word\/(document|header\d*|footer\d*)\.xml$/

export interface SegmentoTexto {
  inicio: number
  fim: number
  texto: string
}

/**
 * Texto de um `<w:t>` em forma canônica.
 *
 * NFC não é capricho: o Word grava "Ç" ora como um code point, ora como "C" +
 * cedilha combinante, e as duas formas parecem idênticas na tela. Sem
 * normalizar, um literal escrito à mão nunca casaria com o texto do arquivo, e
 * o renderizador de PDF desenharia a marca combinante como caractere solto.
 */
export function desescaparXml(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .normalize("NFC")
}

export function escaparXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
}

export async function abrirDocx(buffer: Buffer | Uint8Array): Promise<JSZip> {
  return JSZip.loadAsync(buffer)
}

/** true quando o pacote é um DOCX legível (o `word/document.xml` existe e abre). */
export async function docxIntegro(buffer: Buffer | Uint8Array): Promise<boolean> {
  try {
    const zip = await abrirDocx(buffer)
    const doc = zip.file("word/document.xml")
    if (!doc) return false
    const xml = await doc.async("string")
    return xml.includes("<w:body")
  } catch {
    return false
  }
}

/**
 * Texto visível do pacote inteiro (corpo + cabeçalhos + rodapés), com quebra por
 * parágrafo. É o que o validador lê e o que prova que nenhum placeholder sobrou.
 */
export async function textoDoDocx(buffer: Buffer | Uint8Array): Promise<string> {
  const zip = await abrirDocx(buffer)
  const nomes = Object.keys(zip.files).filter((n) => PARTES_COM_TEXTO.test(n)).sort()
  const partes: string[] = []
  for (const nome of nomes) {
    const xml = await zip.file(nome)!.async("string")
    partes.push(textoDoXml(xml))
  }
  return partes.join("\n")
}

/** Texto visível de uma parte OOXML — `<w:t>` na ordem, parágrafo a parágrafo. */
export function textoDoXml(xml: string): string {
  return xml
    .replace(/<w:p[ >]/g, "\n<w:p ")
    .replace(/<w:br\s*\/>/g, "\n")
    .replace(/<w:tab\s*\/>/g, "\t")
    .split("\n")
    .map((linha) =>
      [...linha.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)]
        .map((m) => desescaparXml(m[1]))
        .join(""),
    )
    .join("\n")
}

// ════════════════════════════════════════════════════════════════════════════
// SUBSTITUIÇÃO
// ════════════════════════════════════════════════════════════════════════════

export interface ResultadoSubstituicao {
  buffer: Buffer
  /** Chaves efetivamente substituídas. */
  substituidas: string[]
  /** Chaves encontradas no template para as quais não veio valor. */
  naoResolvidas: string[]
}

/**
 * Substitui `{{CHAVE}}` pelos valores em TODAS as partes com texto do pacote.
 *
 * O pacote de saída preserva o restante byte a byte: estilos, numeração, tema,
 * imagens do timbrado, cabeçalho e rodapé continuam sendo os mesmos objetos.
 * Só o texto muda — é o que faz o DOCX gerado ter a identidade visual do modelo.
 */
export async function substituirPlaceholdersDocx(
  buffer: Buffer | Uint8Array,
  valores: Record<string, string>,
): Promise<ResultadoSubstituicao> {
  const zip = await abrirDocx(buffer)
  const nomes = Object.keys(zip.files).filter((n) => PARTES_COM_TEXTO.test(n))

  const substituidas = new Set<string>()
  const naoResolvidas = new Set<string>()

  for (const nome of nomes) {
    const xml = await zip.file(nome)!.async("string")
    const novo = substituirEmXml(xml, valores, substituidas, naoResolvidas)
    if (novo !== xml) zip.file(nome, novo, OPCOES_DE_ENTRADA)
  }

  const saida = await zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  })

  return {
    buffer: saida,
    substituidas: [...substituidas],
    naoResolvidas: [...naoResolvidas],
  }
}

/** Substituição em UMA parte OOXML, parágrafo a parágrafo. */
export function substituirEmXml(
  xml: string,
  valores: Record<string, string>,
  substituidas: Set<string> = new Set(),
  naoResolvidas: Set<string> = new Set(),
): string {
  return xml.replace(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>|<w:p(?:\s[^>]*)?\/>/g, (paragrafo) =>
    substituirEmParagrafo(paragrafo, valores, substituidas, naoResolvidas),
  )
}

function substituirEmParagrafo(
  paragrafo: string,
  valores: Record<string, string>,
  substituidas: Set<string>,
  naoResolvidas: Set<string>,
): string {
  const segmentos = segmentosDeTexto(paragrafo)
  if (segmentos.length === 0) return paragrafo

  const juntos = segmentos.map((s) => s.texto).join("")
  if (!juntos.includes("{{")) return paragrafo

  const ocorrencias: Ocorrencia[] = []
  for (const oc of juntos.matchAll(/\{\{\s*([A-Z0-9_]+)\s*\}\}/g)) {
    const chave = oc[1]
    if (!Object.prototype.hasOwnProperty.call(valores, chave)) {
      naoResolvidas.add(chave)
      continue
    }
    substituidas.add(chave)
    ocorrencias.push({
      inicio: oc.index!,
      fim: oc.index! + oc[0].length,
      // A regra de desenho é do REGISTRY, não do template: um modelo novo que use
      // a mesma variável herda o tratamento sem alterar nada aqui.
      valor: valorRenderizado(chave, valores[chave]),
      negrito: regraDeRenderizacao(chave).negrito === true,
    })
  }
  if (ocorrencias.length === 0) return paragrafo

  return reescreverParagrafo(paragrafo, segmentos, ocorrencias)
}

interface Ocorrencia {
  inicio: number
  fim: number
  valor: string
  /** true = o texto inserido sai em run próprio, com negrito. */
  negrito?: boolean
}

/**
 * Aplica recortes no texto CONCATENADO do parágrafo e devolve o XML reescrito.
 *
 * O valor entra no PRIMEIRO `<w:t>` atingido — é o que preserva a formatação
 * pretendida (nome em negrito continua no run em negrito). Os demais `<w:t>`
 * atingidos perdem só a parte coberta; nada além do texto é tocado.
 */
function reescreverParagrafo(
  paragrafo: string,
  segmentos: SegmentoTexto[],
  ocorrencias: Ocorrencia[],
): string {
  const limites: number[] = []
  let acc = 0
  for (const s of segmentos) {
    limites.push(acc)
    acc += s.texto.length
  }

  // Cada segmento vira uma lista de pedaços do texto original, com os intervalos
  // cobertos removidos e o valor inserido no primeiro deles.
  const partes = segmentos.map((s) => [{ inicio: 0, fim: s.texto.length }] as Array<{ inicio: number; fim: number }>)
  const inseridos = segmentos.map(
    () => [] as Array<{ pos: number; valor: string; negrito: boolean }>,
  )

  for (const oc of [...ocorrencias].sort((a, b) => a.inicio - b.inicio)) {
    let primeiro = true
    for (let i = 0; i < segmentos.length; i++) {
      const segInicio = limites[i]
      const segFim = segInicio + segmentos[i].texto.length
      if (segFim <= oc.inicio || segInicio >= oc.fim) continue

      const localInicio = Math.max(0, oc.inicio - segInicio)
      const localFim = Math.min(segmentos[i].texto.length, oc.fim - segInicio)

      partes[i] = partes[i].flatMap((p) => {
        if (localFim <= p.inicio || localInicio >= p.fim) return [p]
        const restos: Array<{ inicio: number; fim: number }> = []
        if (p.inicio < localInicio) restos.push({ inicio: p.inicio, fim: localInicio })
        if (localFim < p.fim) restos.push({ inicio: localFim, fim: p.fim })
        return restos
      })

      if (primeiro) {
        inseridos[i].push({ pos: localInicio, valor: oc.valor, negrito: oc.negrito === true })
        primeiro = false
      }
    }
  }

  let saida = paragrafo
  for (let i = segmentos.length - 1; i >= 0; i--) {
    const original = segmentos[i].texto
    const eventos = [
      ...partes[i].map((p) => ({
        pos: p.inicio,
        texto: original.slice(p.inicio, p.fim),
        negrito: false,
      })),
      ...inseridos[i].map((ins) => ({ pos: ins.pos, texto: ins.valor, negrito: ins.negrito })),
    ].sort((a, b) => a.pos - b.pos)

    const novo = eventos.map((e) => e.texto).join("")
    if (novo === original) continue

    const seg = segmentos[i]
    saida =
      saida.slice(0, seg.inicio) +
      montarTexto(paragrafo, seg, eventos) +
      saida.slice(seg.fim)
  }
  return saida
}

interface PedacoDeTexto {
  texto: string
  negrito: boolean
}

/**
 * Reescreve UM `<w:t>`.
 *
 * Sem pedaço em negrito, o resultado é o mesmo `<w:t>` de sempre — o caminho
 * comum não muda em nada.
 *
 * Com negrito, o texto inserido precisa de um run PRÓPRIO: negrito é atributo de
 * run (`w:rPr/w:b`), e engrossar o run inteiro deixaria a qualificação toda em
 * negrito. A solução é fechar o run corrente depois do prefixo, abrir um run com
 * as MESMAS propriedades acrescidas de `w:b`, e reabrir outro run igual ao
 * original para o sufixo — que a marcação de fechamento já existente no XML
 * encerra. Fonte, tamanho, cor, sublinhado e alinhamento seguem intactos, porque
 * o `w:rPr` copiado é o do próprio run.
 */
function montarTexto(paragrafo: string, seg: SegmentoTexto, pedacos: PedacoDeTexto[]): string {
  const comNegrito = pedacos.some((p) => p.negrito && p.texto.length > 0)
  const escrever = (t: string) => `<w:t xml:space="preserve">${escaparXml(t)}</w:t>`

  if (!comNegrito) {
    return escrever(pedacos.map((p) => p.texto).join(""))
  }

  const run = runQueEnvolve(paragrafo, seg.inicio)
  // Sem run identificável (marcação inesperada), o texto entra sem negrito em vez
  // de sair XML quebrado: um documento sem ênfase é corrigível; um DOCX que não
  // abre, não.
  if (!run) return escrever(pedacos.map((p) => p.texto).join(""))

  const partes: string[] = []
  let dentroDoRunOriginal = true

  for (const pedaco of pedacos) {
    if (!pedaco.texto) continue
    if (pedaco.negrito) {
      partes.push(`</w:r>${run.abertura}${aplicarNegrito(run.rPr)}${escrever(pedaco.texto)}</w:r>`)
      dentroDoRunOriginal = false
      continue
    }
    if (!dentroDoRunOriginal) {
      partes.push(`${run.abertura}${run.rPr}${escrever(pedaco.texto)}`)
      dentroDoRunOriginal = true
      continue
    }
    partes.push(escrever(pedaco.texto))
  }

  // O `</w:r>` original do documento fecha o último run aberto aqui. Quando o
  // último pedaço foi o negrito (já fechado), é preciso reabrir um run vazio para
  // esse fechamento ter par.
  if (!dentroDoRunOriginal) partes.push(`${run.abertura}${run.rPr}`)

  return partes.join("")
}

/**
 * Marcação de abertura e `w:rPr` do `<w:r>` que contém a posição informada.
 *
 * A busca anda para trás porque `<w:rPr>` e `<w:rFonts>` também começam com
 * "<w:r": o primeiro casamento quase nunca é o run. O laço recua até achar uma
 * abertura de run de verdade.
 */
function runQueEnvolve(xml: string, posicao: number): { abertura: string; rPr: string } | null {
  let cursor = posicao
  while (cursor > 0) {
    const inicio = xml.lastIndexOf("<w:r", cursor - 1)
    if (inicio < 0) return null

    const fimDaAbertura = xml.indexOf(">", inicio)
    if (fimDaAbertura < 0) return null

    const abertura = xml.slice(inicio, fimDaAbertura + 1)
    if (fimDaAbertura < posicao && /^<w:r(\s[^>]*)?>$/.test(abertura)) {
      const resto = xml.slice(fimDaAbertura + 1, posicao)
      const rPr = resto.match(/^\s*(<w:rPr>[\s\S]*?<\/w:rPr>|<w:rPr\s*\/>)/)?.[1] ?? ""
      return { abertura, rPr }
    }
    cursor = inicio
  }
  return null
}

/**
 * `w:rPr` com negrito ligado, respeitando a ordem exigida pelo esquema.
 *
 * `w:b` e `w:bCs` vêm logo depois de `w:rFonts` — fora de ordem, o Word recusa o
 * documento. Se o run já era negrito, nada é acrescentado.
 */
function aplicarNegrito(rPr: string): string {
  if (!rPr || /^<w:rPr\s*\/>$/.test(rPr)) return "<w:rPr><w:b/><w:bCs/></w:rPr>"
  if (/<w:b\s*\/>|<w:b\s[^>]*\/>/.test(rPr)) return rPr

  const fontes = rPr.match(/<w:rFonts\b[^>]*\/>/)
  if (fontes) {
    const posicao = rPr.indexOf(fontes[0]) + fontes[0].length
    return rPr.slice(0, posicao) + "<w:b/><w:bCs/>" + rPr.slice(posicao)
  }
  return rPr.replace("<w:rPr>", "<w:rPr><w:b/><w:bCs/>")
}

// ════════════════════════════════════════════════════════════════════════════
// PREPARAÇÃO DE TEMPLATE — converter um documento real em modelo
// ════════════════════════════════════════════════════════════════════════════

/**
 * Troca TRECHOS LITERAIS de texto pelo marcador de variável, preservando runs.
 *
 * Serve para uma coisa só: transformar um documento oficial já redigido (que
 * traz os dados de um cliente concreto) no TEMPLATE correspondente. É operação
 * de PREPARAÇÃO, feita uma vez, com os trechos ditos explicitamente — nunca uma
 * heurística de runtime procurando nome de cliente dentro do arquivo.
 */
export interface ParLiteral {
  de: string
  para: string
  /** Quantas ocorrências trocar, em ordem de documento. Ausente = todas. */
  limite?: number
}

export async function substituirLiteraisDocx(
  buffer: Buffer | Uint8Array,
  pares: ParLiteral[],
): Promise<{ buffer: Buffer; aplicados: string[]; naoEncontrados: string[] }> {
  const zip = await abrirDocx(buffer)
  const nomes = Object.keys(zip.files).filter((n) => PARTES_COM_TEXTO.test(n)).sort()
  const aplicados = new Set<string>()
  const usados = pares.map(() => 0)

  for (const nome of nomes) {
    const xml = await zip.file(nome)!.async("string")
    // Campos do Word (data automática) viram texto simples: um campo TIME se
    // recalcularia ao abrir o documento e sobrescreveria a data da emissão.
    const semCampos = removerCamposDeTexto(xml)
    const novo = semCampos.replace(
      /<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>|<w:p(?:\s[^>]*)?\/>/g,
      (paragrafo) => {
        const segmentos = segmentosDeTexto(paragrafo)
        if (segmentos.length === 0) return paragrafo
        const juntos = segmentos.map((s) => s.texto).join("")

        const ocorrencias: Array<{ inicio: number; fim: number; valor: string }> = []
        for (let p = 0; p < pares.length; p++) {
          const { de, para, limite } = pares[p]
          let idx = juntos.indexOf(de)
          while (idx >= 0) {
            if (limite != null && usados[p] >= limite) break
            const conflita = ocorrencias.some((o) => idx < o.fim && idx + de.length > o.inicio)
            if (!conflita) {
              ocorrencias.push({ inicio: idx, fim: idx + de.length, valor: para })
              aplicados.add(de)
              usados[p]++
            }
            idx = juntos.indexOf(de, idx + de.length)
          }
        }
        if (ocorrencias.length === 0) return paragrafo
        return reescreverParagrafo(paragrafo, segmentos, ocorrencias)
      },
    )
    if (novo !== xml) zip.file(nome, novo, OPCOES_DE_ENTRADA)
  }

  const saida = await zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  })

  return {
    buffer: saida,
    aplicados: [...aplicados],
    naoEncontrados: pares.map((p) => p.de).filter((de) => !aplicados.has(de)),
  }
}

/** Remove os runs de campo (`fldChar`/`instrText`), preservando o resultado. */
export function removerCamposDeTexto(xml: string): string {
  return xml.replace(/<w:r(?:\s[^>]*)?>[\s\S]*?<\/w:r>/g, (run) =>
    run.includes("<w:fldChar") || run.includes("<w:instrText") ? "" : run,
  )
}

/** Posições e conteúdo de cada `<w:t>` do trecho, na ordem do documento. */
export function segmentosDeTexto(xml: string): SegmentoTexto[] {
  const out: SegmentoTexto[] = []
  const re = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(xml)) !== null) {
    out.push({ inicio: m.index, fim: m.index + m[0].length, texto: desescaparXml(m[1]) })
  }
  return out
}

// ════════════════════════════════════════════════════════════════════════════
// ESTRUTURA — o que o renderizador de PDF consome
// ════════════════════════════════════════════════════════════════════════════

export interface TrechoFormatado {
  texto: string
  negrito: boolean
  italico: boolean
  sublinhado: boolean
  /** Tamanho em pontos. */
  tamanho: number
  /** Quebra de linha forçada ANTES deste trecho (`<w:br/>`). */
  quebraAntes: boolean
}

export interface ParagrafoFormatado {
  trechos: TrechoFormatado[]
  alinhamento: "left" | "center" | "right" | "justify"
  /** Entrelinha múltipla (1 = simples, 1.5, 2…). */
  entrelinha: number
  /** Espaço depois do parágrafo, em pontos. */
  espacoDepois: number
  /** Recuo da primeira linha, em pontos. */
  recuoPrimeiraLinha: number
  recuoEsquerda: number
  recuoDireita: number
}

export interface PaginaDocx {
  /** Largura e altura em pontos. */
  largura: number
  altura: number
  margemTopo: number
  margemDireita: number
  margemBase: number
  margemEsquerda: number
}

export interface ImagemDocx {
  dados: Uint8Array
  formato: "PNG" | "JPEG"
  /** Dimensões em pontos. */
  largura: number
  altura: number
  alinhamento: "left" | "center" | "right"
  /** Deslocamento vertical em pontos, relativo ao topo do bloco. */
  deslocamentoY: number
}

/** Cabeçalho ou rodapé — repetido em TODAS as páginas, como no Word. */
export interface BlocoDePagina {
  paragrafos: ParagrafoFormatado[]
  imagens: ImagemDocx[]
}

export interface EstruturaDocx {
  pagina: PaginaDocx
  paragrafos: ParagrafoFormatado[]
  cabecalho: BlocoDePagina | null
  rodape: BlocoDePagina | null
  /** Distância do topo da página ao cabeçalho, em pontos. */
  distanciaCabecalho: number
  /** Distância da base da página ao rodapé, em pontos. */
  distanciaRodape: number
  /** Família tipográfica declarada pelo tema do pacote (ex.: "Aptos", "Times New Roman"). */
  fonte: string
}

/** Twips (1/20 de ponto) → pontos. */
const twips = (v: string | undefined, padrao: number) =>
  v == null ? padrao : Number(v) / 20

function atributo(xml: string, tag: string, attr = "w:val"): string | undefined {
  const m = xml.match(new RegExp(`<${tag}\\b[^>]*\\s${attr}="([^"]*)"`))
  return m?.[1]
}

function temTag(xml: string, tag: string): boolean {
  // `<w:b/>` liga; `<w:b w:val="0"/>` desliga.
  const m = xml.match(new RegExp(`<${tag}(\\s[^>]*)?/?>`))
  if (!m) return false
  const attrs = m[1] ?? ""
  const val = attrs.match(/w:val="([^"]*)"/)?.[1]
  return val !== "0" && val !== "false"
}

/**
 * Estrutura do DOCX **gerado** — parágrafos, formatação e geometria da página.
 *
 * O PDF sai DAQUI, do pacote já substituído. Não existe segunda fonte: se o
 * DOCX diz "negrito, 12pt, centralizado", é isso que o PDF desenha. Trocar o
 * template muda os dois arquivos junto, porque só existe um original.
 */
export async function estruturaDoDocx(buffer: Buffer | Uint8Array): Promise<EstruturaDocx> {
  const zip = await abrirDocx(buffer)
  const documento = await zip.file("word/document.xml")!.async("string")
  const estilosXml = (await zip.file("word/styles.xml")?.async("string")) ?? ""
  const temaXml = (await zip.file("word/theme/theme1.xml")?.async("string")) ?? ""

  const docDefaults = estilosXml.match(/<w:docDefaults>[\s\S]*?<\/w:docDefaults>/)?.[0] ?? ""
  const tamanhoPadrao = Number(atributo(docDefaults, "w:sz") ?? 22) / 2
  const spacingPadrao = docDefaults.match(/<w:spacing\b[^>]*>/)?.[0] ?? ""
  const padroes = {
    espacoDepois: Number(spacingPadrao.match(/w:after="([^"]*)"/)?.[1] ?? 160) / 20,
    entrelinha: Number(spacingPadrao.match(/w:line="([^"]*)"/)?.[1] ?? 240) / 240,
  }
  const estilos = mapaDeEstilos(estilosXml)

  // Fonte do TEMA — é ela que o Word aplica quando o run diz "minorHAnsi".
  const fonte =
    temaXml.match(/<a:minorFont>[\s\S]*?<a:latin[^>]*typeface="([^"]*)"/)?.[1] ||
    atributo(docDefaults, "w:rFonts", "w:ascii") ||
    "Calibri"

  const sect = documento.match(/<w:sectPr[\s\S]*?<\/w:sectPr>/)?.[0] ?? ""
  const pgSz = sect.match(/<w:pgSz\b[^>]*>/)?.[0] ?? ""
  const pgMar = sect.match(/<w:pgMar\b[^>]*>/)?.[0] ?? ""
  const attr = (s: string, a: string) => s.match(new RegExp(`${a}="([^"]*)"`))?.[1]

  const pagina: PaginaDocx = {
    largura: twips(attr(pgSz, "w:w"), 595.3),
    altura: twips(attr(pgSz, "w:h"), 841.9),
    margemTopo: twips(attr(pgMar, "w:top"), 70.85),
    margemDireita: twips(attr(pgMar, "w:right"), 85.05),
    margemBase: twips(attr(pgMar, "w:bottom"), 70.85),
    margemEsquerda: twips(attr(pgMar, "w:left"), 85.05),
  }

  const corpo = documento.slice(documento.indexOf("<w:body"))
  const paragrafos: ParagrafoFormatado[] = []

  for (const m of corpo.matchAll(/<w:p(?:\s[^>]*)?>([\s\S]*?)<\/w:p>|<w:p(?:\s[^>]*)?\/>/g)) {
    const interno = m[1] ?? ""
    paragrafos.push(lerParagrafo(interno, tamanhoPadrao, estilos, padroes))
  }

  // CABEÇALHO E RODAPÉ — o timbrado faz parte do documento. Ignorá-los produziria
  // um PDF que não é o mesmo papel que o DOCX, e o instrumento perderia a
  // identidade visual da banca.
  const refCabecalho = sect.match(/<w:headerReference\b[^>]*r:id="([^"]*)"/)?.[1]
  const refRodape = sect.match(/<w:footerReference\b[^>]*r:id="([^"]*)"/)?.[1]
  const relsDoc = (await zip.file("word/_rels/document.xml.rels")?.async("string")) ?? ""

  const cabecalho = await lerBlocoDePagina(zip, relsDoc, refCabecalho, tamanhoPadrao, estilos, padroes)
  const rodape = await lerBlocoDePagina(zip, relsDoc, refRodape, tamanhoPadrao, estilos, padroes)

  return {
    pagina,
    paragrafos,
    cabecalho,
    rodape,
    distanciaCabecalho: twips(attr(pgMar, "w:header"), 35.4),
    distanciaRodape: twips(attr(pgMar, "w:footer"), 35.4),
    fonte,
  }
}

/** EMU (English Metric Unit) → pontos. */
const emu = (v: string | number) => Number(v) / 12700

function alvoDaRelacao(rels: string, id: string | undefined): string | null {
  if (!id) return null
  const m = rels.match(new RegExp(`<Relationship\\b[^>]*Id="${id}"[^>]*Target="([^"]*)"`))
  return m ? m[1] : null
}

async function lerBlocoDePagina(
  zip: JSZip,
  relsDocumento: string,
  refId: string | undefined,
  tamanhoPadrao: number,
  estilos: Map<string, EstiloResolvido>,
  padroes: { espacoDepois: number; entrelinha: number },
): Promise<BlocoDePagina | null> {
  const alvo = alvoDaRelacao(relsDocumento, refId)
  if (!alvo) return null
  const caminho = `word/${alvo}`
  const arquivo = zip.file(caminho)
  if (!arquivo) return null

  const xml = await arquivo.async("string")
  const rels = (await zip.file(`word/_rels/${alvo}.rels`)?.async("string")) ?? ""

  const paragrafos: ParagrafoFormatado[] = []
  for (const m of xml.matchAll(/<w:p(?:\s[^>]*)?>([\s\S]*?)<\/w:p>|<w:p(?:\s[^>]*)?\/>/g)) {
    paragrafos.push(lerParagrafo(m[1] ?? "", tamanhoPadrao, estilos, padroes))
  }

  const imagens: ImagemDocx[] = []
  for (const d of xml.matchAll(/<w:drawing>[\s\S]*?<\/w:drawing>/g)) {
    const bloco = d[0]
    const embed = bloco.match(/<a:blip\b[^>]*r:embed="([^"]*)"/)?.[1]
    const midia = alvoDaRelacao(rels, embed)
    if (!midia) continue
    const arquivoMidia = zip.file(`word/${midia}`)
    if (!arquivoMidia) continue

    const ext = midia.split(".").pop()?.toLowerCase()
    if (ext !== "png" && ext !== "jpg" && ext !== "jpeg") continue

    const extent = bloco.match(/<wp:extent\b[^>]*cx="(\d+)"[^>]*cy="(\d+)"/)
    if (!extent) continue

    const alinhamento = /<wp:align>\s*center\s*<\/wp:align>/.test(bloco)
      ? "center"
      : /<wp:align>\s*right\s*<\/wp:align>/.test(bloco)
        ? "right"
        : "left"

    const offsetV = bloco.match(/<wp:positionV\b[\s\S]*?<wp:posOffset>(-?\d+)<\/wp:posOffset>/)?.[1]

    imagens.push({
      dados: await arquivoMidia.async("uint8array"),
      formato: ext === "png" ? "PNG" : "JPEG",
      largura: emu(extent[1]),
      altura: emu(extent[2]),
      alinhamento,
      deslocamentoY: offsetV ? emu(offsetV) : 0,
    })
  }

  return { paragrafos, imagens }
}

interface EstiloResolvido {
  negrito: boolean
  italico: boolean
  tamanho?: number
  alinhamento?: ParagrafoFormatado["alinhamento"]
}

function mapaDeEstilos(estilosXml: string): Map<string, EstiloResolvido> {
  const mapa = new Map<string, EstiloResolvido>()
  for (const m of estilosXml.matchAll(/<w:style\b[^>]*w:styleId="([^"]*)"[^>]*>([\s\S]*?)<\/w:style>/g)) {
    const corpo = m[2]
    const sz = atributo(corpo, "w:sz")
    mapa.set(m[1], {
      negrito: temTag(corpo, "w:b"),
      italico: temTag(corpo, "w:i"),
      tamanho: sz ? Number(sz) / 2 : undefined,
      alinhamento: converterAlinhamento(atributo(corpo, "w:jc")),
    })
  }
  return mapa
}

function converterAlinhamento(val: string | undefined): ParagrafoFormatado["alinhamento"] | undefined {
  switch (val) {
    case "center": return "center"
    case "right":
    case "end": return "right"
    case "both":
    case "distribute": return "justify"
    case "left":
    case "start": return "left"
    default: return undefined
  }
}

function lerParagrafo(
  interno: string,
  tamanhoPadrao: number,
  estilos: Map<string, EstiloResolvido>,
  padroes: { espacoDepois: number; entrelinha: number },
): ParagrafoFormatado {
  const pPr = interno.match(/<w:pPr>[\s\S]*?<\/w:pPr>/)?.[0] ?? ""
  const estiloId = atributo(pPr, "w:pStyle")
  const estilo = estiloId ? estilos.get(estiloId) : undefined

  const spacing = pPr.match(/<w:spacing\b[^>]*>/)?.[0] ?? ""
  const ind = pPr.match(/<w:ind\b[^>]*>/)?.[0] ?? ""
  const attr = (s: string, a: string) => s.match(new RegExp(`${a}="([^"]*)"`))?.[1]

  const lineRule = attr(spacing, "w:lineRule")
  const line = attr(spacing, "w:line")
  const entrelinha =
    line && lineRule !== "exact" && lineRule !== "atLeast" ? Number(line) / 240 : padroes.entrelinha

  const trechos: TrechoFormatado[] = []
  // O corpo do parágrafo, sem o bloco de propriedades (que também tem `<w:rPr>`).
  const corpoRuns = interno.replace(/<w:pPr>[\s\S]*?<\/w:pPr>/, "")

  for (const r of corpoRuns.matchAll(/<w:r(?:\s[^>]*)?>([\s\S]*?)<\/w:r>/g)) {
    const run = r[1]
    // Campos do Word (data automática, por exemplo) não são texto do documento:
    // o que vale é o resultado, que já vem em `<w:t>`.
    if (run.includes("<w:instrText")) continue
    const rPr = run.match(/<w:rPr>[\s\S]*?<\/w:rPr>/)?.[0] ?? ""
    const sz = atributo(rPr, "w:sz")
    const formato = {
      negrito: temTag(rPr, "w:b") || (estilo?.negrito ?? false),
      italico: temTag(rPr, "w:i") || (estilo?.italico ?? false),
      sublinhado: temTag(rPr, "w:u"),
      tamanho: sz ? Number(sz) / 2 : estilo?.tamanho ?? tamanhoPadrao,
    }

    let quebraPendente = false
    for (const parte of run.matchAll(/<w:br\s*\/>|<w:tab\s*\/>|<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)) {
      if (parte[0].startsWith("<w:br")) { quebraPendente = true; continue }
      if (parte[0].startsWith("<w:tab")) {
        trechos.push({ texto: "    ", ...formato, quebraAntes: quebraPendente })
        quebraPendente = false
        continue
      }
      trechos.push({ texto: desescaparXml(parte[1]), ...formato, quebraAntes: quebraPendente })
      quebraPendente = false
    }
    if (quebraPendente) {
      trechos.push({ texto: "", ...formato, quebraAntes: true })
    }
  }

  return {
    trechos,
    alinhamento: converterAlinhamento(atributo(pPr, "w:jc")) ?? estilo?.alinhamento ?? "left",
    entrelinha,
    espacoDepois:
      attr(spacing, "w:after") != null ? Number(attr(spacing, "w:after")) / 20 : padroes.espacoDepois,
    recuoPrimeiraLinha: attr(ind, "w:firstLine") != null ? Number(attr(ind, "w:firstLine")) / 20 : 0,
    recuoEsquerda: attr(ind, "w:left") != null ? Number(attr(ind, "w:left")) / 20 : 0,
    recuoDireita: attr(ind, "w:right") != null ? Number(attr(ind, "w:right")) / 20 : 0,
  }
}
