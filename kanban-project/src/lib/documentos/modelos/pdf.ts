// src/lib/documentos/modelos/pdf.ts
//
// PDF A PARTIR DO DOCX GERADO — nunca a partir do template, nunca a partir dos
// dados, nunca a partir de um HTML paralelo.
//
// A ENTRADA DESTE MÓDULO É O BINÁRIO DO DOCX QUE ACABOU DE SER PRODUZIDO. Ele
// abre o pacote, lê a geometria da página, a formatação de cada parágrafo e o
// texto já substituído, e desenha exatamente isso. Se o DOCX mudar, o PDF muda
// junto — não existe caminho pelo qual os dois divirjam, porque não existe uma
// segunda origem de conteúdo.
//
// POR QUE NÃO UM CONVERSOR EXTERNO: converter DOCX→PDF com LibreOffice exigiria
// um binário que o runtime da aplicação não tem. A alternativa honesta não é
// gerar o PDF de outro lugar (isso criaria a segunda fonte que a arquitetura
// proíbe) — é RENDERIZAR O PRÓPRIO DOCX. O que se perde são recursos que os
// modelos não usam (tabelas complexas, colunas, quebras condicionais); o que se
// preserva é o que eles usam: página, margens, alinhamento, entrelinha, recuo,
// negrito, itálico, sublinhado, tamanho, quebras e paginação.

import { createHash } from "crypto"
import { jsPDF } from "jspdf"
import {
  estruturaDoDocx,
  type BlocoDePagina,
  type EstruturaDocx,
  type ParagrafoFormatado,
  type TrechoFormatado,
} from "./docx"

/** Fonte do tema → família base do PDF. Sem adivinhação: mapa explícito. */
function familiaPdf(fonteDoTema: string): "helvetica" | "times" | "courier" {
  const f = fonteDoTema.toLowerCase()
  if (/times|cambria|georgia|garamond|book|serif|minion/.test(f)) return "times"
  if (/courier|mono|consolas/.test(f)) return "courier"
  return "helvetica"
}

interface PalavraMedida {
  texto: string
  largura: number
  trecho: TrechoFormatado
}

interface LinhaMontada {
  palavras: PalavraMedida[]
  largura: number
  alturaLinha: number
  /** true quando a linha termina o parágrafo (não se justifica a última linha). */
  ultima: boolean
  primeira: boolean
}

/**
 * Renderiza o DOCX (já substituído) em PDF.
 *
 * Determinístico: mesmos bytes de entrada produzem os mesmos bytes de saída —
 * a data de criação do PDF é fixada, senão o checksum mudaria a cada chamada e
 * deixaria de provar coisa alguma.
 */
export async function pdfDoDocx(docx: Buffer | Uint8Array): Promise<Buffer> {
  const estrutura = await estruturaDoDocx(docx)
  // A identidade do PDF DERIVA do DOCX de origem. Não é enfeite: é o que torna
  // o par (DOCX, PDF) verificável — e o que faz duas renderizações do mesmo
  // DOCX terem o mesmo checksum, em vez de carimbarem a hora da chamada.
  const identidade = createHash("md5").update(docx).digest("hex").toUpperCase()
  return desenhar(estrutura, identidade)
}

function desenhar(estrutura: EstruturaDocx, identidade: string): Buffer {
  const { pagina } = estrutura
  const familia = familiaPdf(estrutura.fonte)

  const doc = new jsPDF({
    unit: "pt",
    format: [pagina.largura, pagina.altura],
    orientation: pagina.largura > pagina.altura ? "landscape" : "portrait",
    compress: true,
  })
  // Determinismo: data de criação fixa e identificador derivado do DOCX. Sem
  // isso o mesmo documento teria um checksum novo a cada renderização.
  doc.setCreationDate("D:19700101000000+00'00'")
  doc.setFileId(identidade)

  // ── Cabeçalho e rodapé ────────────────────────────────────────────────────
  // Medidos ANTES do corpo porque é a altura deles que define onde o texto pode
  // começar e terminar — no Word, timbrado alto empurra o conteúdo para baixo.
  const alturaCabecalho = alturaDoBloco(doc, familia, estrutura.cabecalho, estrutura, pagina)
  const alturaRodape = alturaDoBloco(doc, familia, estrutura.rodape, estrutura, pagina)

  const topoConteudo = Math.max(
    pagina.margemTopo,
    alturaCabecalho > 0 ? estrutura.distanciaCabecalho + alturaCabecalho + 6 : 0,
  )
  const limiteInferior = Math.min(
    pagina.altura - pagina.margemBase,
    alturaRodape > 0 ? pagina.altura - estrutura.distanciaRodape - alturaRodape - 6 : Infinity,
  )

  const desenharBlocosFixos = () => {
    desenharBloco(doc, familia, estrutura.cabecalho, estrutura, pagina, estrutura.distanciaCabecalho)
    desenharBloco(
      doc,
      familia,
      estrutura.rodape,
      estrutura,
      pagina,
      pagina.altura - estrutura.distanciaRodape - alturaRodape,
    )
  }

  desenharBlocosFixos()
  let y = topoConteudo

  for (const paragrafo of estrutura.paragrafos) {
    const larguraUtil =
      pagina.largura -
      pagina.margemEsquerda -
      pagina.margemDireita -
      paragrafo.recuoEsquerda -
      paragrafo.recuoDireita

    const linhas = quebrarEmLinhas(doc, familia, paragrafo, larguraUtil)

    // Parágrafo vazio ainda ocupa uma linha — é o espaçamento que o autor quis.
    if (linhas.length === 0) {
      const alturaVazia = alturaDeLinha(12, paragrafo.entrelinha)
      if (y + alturaVazia > limiteInferior) { doc.addPage(); desenharBlocosFixos(); y = topoConteudo }
      y += alturaVazia + paragrafo.espacoDepois
      continue
    }

    for (const linha of linhas) {
      if (y + linha.alturaLinha > limiteInferior) {
        doc.addPage()
        desenharBlocosFixos()
        y = topoConteudo
      }
      escreverLinha(doc, familia, linha, paragrafo, pagina, larguraUtil, y)
      y += linha.alturaLinha
    }
    y += paragrafo.espacoDepois
  }

  return Buffer.from(doc.output("arraybuffer"))
}

const alturaDeLinha = (tamanho: number, entrelinha: number) => tamanho * 1.15 * entrelinha

/** Altura total ocupada por um cabeçalho/rodapé — texto e imagens juntos. */
function alturaDoBloco(
  doc: jsPDF,
  familia: "helvetica" | "times" | "courier",
  bloco: BlocoDePagina | null,
  estrutura: EstruturaDocx,
  pagina: EstruturaDocx["pagina"],
): number {
  if (!bloco) return 0
  let altura = 0
  for (const img of bloco.imagens) {
    altura = Math.max(altura, Math.max(0, img.deslocamentoY) + img.altura)
  }
  const larguraUtil = pagina.largura - pagina.margemEsquerda - pagina.margemDireita
  for (const p of bloco.paragrafos) {
    const linhas = quebrarEmLinhas(doc, familia, p, larguraUtil)
    if (linhas.length === 0) continue
    altura += linhas.reduce((s, l) => s + l.alturaLinha, 0) + p.espacoDepois
  }
  void estrutura
  return altura
}

/** Desenha cabeçalho/rodapé com o topo em `topo`. Repetido em cada página. */
function desenharBloco(
  doc: jsPDF,
  familia: "helvetica" | "times" | "courier",
  bloco: BlocoDePagina | null,
  estrutura: EstruturaDocx,
  pagina: EstruturaDocx["pagina"],
  topo: number,
) {
  if (!bloco) return
  const larguraUtil = pagina.largura - pagina.margemEsquerda - pagina.margemDireita

  for (const img of bloco.imagens) {
    const x =
      img.alinhamento === "center"
        ? pagina.margemEsquerda + (larguraUtil - img.largura) / 2
        : img.alinhamento === "right"
          ? pagina.largura - pagina.margemDireita - img.largura
          : pagina.margemEsquerda
    try {
      doc.addImage(img.dados, img.formato, x, topo + Math.max(0, img.deslocamentoY), img.largura, img.altura)
    } catch {
      // Imagem ilegível não invalida o documento — o texto continua íntegro.
    }
  }

  let y = topo + bloco.imagens.reduce((m, i) => Math.max(m, Math.max(0, i.deslocamentoY) + i.altura), 0)
  for (const p of bloco.paragrafos) {
    const linhas = quebrarEmLinhas(doc, familia, p, larguraUtil)
    for (const linha of linhas) {
      escreverLinha(doc, familia, linha, p, pagina, larguraUtil, y)
      y += linha.alturaLinha
    }
    y += p.espacoDepois
  }
  void estrutura
}


// ── MEDIÇÃO ────────────────────────────────────────────────────────────────
// `getTextWidth` de uma frase aplica kerning que o PDF gerado NÃO reproduz na
// hora de desenhar: a medida sai menor que o traçado, e a diferença aparece
// como palavra colada na seguinte ("SP,CEP"). A largura usada aqui é a soma das
// larguras de CADA caractere — que é exatamente o avanço que o visualizador usa.
const cacheLargura = new Map<string, number>()

function larguraDoTexto(
  doc: jsPDF,
  familia: "helvetica" | "times" | "courier",
  trecho: TrechoFormatado,
  texto: string,
): number {
  const estilo = estiloDaFonte(trecho)
  let total = 0
  for (const ch of texto) {
    const chave = `${familia}|${estilo}|${ch}`
    let unidade = cacheLargura.get(chave)
    if (unidade == null) {
      doc.setFont(familia, estilo)
      doc.setFontSize(1000)
      unidade = doc.getTextWidth(ch)
      cacheLargura.set(chave, unidade)
    }
    total += unidade
  }
  doc.setFont(familia, estilo)
  doc.setFontSize(trecho.tamanho)
  return (total * trecho.tamanho) / 1000
}

function estiloDaFonte(trecho: TrechoFormatado): string {
  return trecho.negrito && trecho.italico
    ? "bolditalic"
    : trecho.negrito
      ? "bold"
      : trecho.italico
        ? "italic"
        : "normal"
}

function aplicarFonte(
  doc: jsPDF,
  familia: "helvetica" | "times" | "courier",
  trecho: TrechoFormatado,
) {
  doc.setFont(familia, estiloDaFonte(trecho))
  doc.setFontSize(trecho.tamanho)
}

function quebrarEmLinhas(
  doc: jsPDF,
  familia: "helvetica" | "times" | "courier",
  paragrafo: ParagrafoFormatado,
  larguraUtil: number,
): LinhaMontada[] {
  const linhas: LinhaMontada[] = []
  let atual: PalavraMedida[] = []
  let larguraAtual = 0
  let primeira = true

  const fechar = (ultima: boolean) => {
    if (atual.length === 0 && !ultima) return
    const tamanhoMax = atual.reduce((m, p) => Math.max(m, p.trecho.tamanho), 12)
    linhas.push({
      palavras: atual,
      largura: larguraAtual,
      alturaLinha: alturaDeLinha(tamanhoMax, paragrafo.entrelinha),
      ultima,
      primeira,
    })
    primeira = false
    atual = []
    larguraAtual = 0
  }

  const recuoPrimeira = () => (primeira ? paragrafo.recuoPrimeiraLinha : 0)

  for (const trecho of paragrafo.trechos) {
    if (trecho.quebraAntes) fechar(false)
    if (!trecho.texto) continue

    aplicarFonte(doc, familia, trecho)
    // A separação preserva o espaço: ele pertence à palavra anterior, e é o que
    // mantém o texto idêntico ao do DOCX quando as linhas se recompõem.
    const pedacos = trecho.texto.match(/\S+\s*|\s+/g) ?? []
    for (const pedaco of pedacos) {
      const largura = larguraDoTexto(doc, familia, trecho, pedaco)
      if (
        atual.length > 0 &&
        larguraAtual + larguraDoTexto(doc, familia, trecho, pedaco.trimEnd()) + recuoPrimeira() > larguraUtil
      ) {
        fechar(false)
        if (/^\s+$/.test(pedaco)) continue // espaço no início da linha nova some
      }
      atual.push({ texto: pedaco, largura, trecho })
      larguraAtual += largura
    }
  }
  fechar(true)

  // Parágrafo sem nenhum texto não gera linha — quem trata é o chamador.
  if (linhas.length === 1 && linhas[0].palavras.length === 0) return []
  return linhas
}

function escreverLinha(
  doc: jsPDF,
  familia: "helvetica" | "times" | "courier",
  linha: LinhaMontada,
  paragrafo: ParagrafoFormatado,
  pagina: EstruturaDocx["pagina"],
  larguraUtil: number,
  y: number,
) {
  if (linha.palavras.length === 0) return

  const esquerda = pagina.margemEsquerda + paragrafo.recuoEsquerda
  const recuo = linha.primeira ? paragrafo.recuoPrimeiraLinha : 0
  const larguraTexto = linha.palavras.reduce(
    (s, p, i) => s + (i === linha.palavras.length - 1 ? medirSemEspacoFinal(doc, familia, p) : p.largura),
    0,
  )

  let x = esquerda + recuo
  let espacoExtra = 0

  switch (paragrafo.alinhamento) {
    case "center":
      x = esquerda + (larguraUtil - larguraTexto) / 2
      break
    case "right":
      x = esquerda + larguraUtil - larguraTexto
      break
    case "justify": {
      if (!linha.ultima) {
        const lacunas = linha.palavras.filter((p) => /\s$/.test(p.texto)).length
        // Nunca negativo: justificar não pode COMER espaço entre palavras. Uma
        // linha que estoura por frações de ponto sangraria a margem em vez de
        // grudar "SP," em "CEP".
        if (lacunas > 0) espacoExtra = Math.max(0, (larguraUtil - recuo - larguraTexto) / lacunas)
      }
      break
    }
    default:
      break
  }

  const linhaBase = y + linha.alturaLinha * 0.8

  for (let i = 0; i < linha.palavras.length; i++) {
    const p = linha.palavras[i]
    const ultima = i === linha.palavras.length - 1
    const texto = ultima ? p.texto.replace(/\s+$/, "") : p.texto
    if (!texto) continue

    aplicarFonte(doc, familia, p.trecho)
    doc.text(texto, x, linhaBase)

    if (p.trecho.sublinhado) {
      const largura = larguraDoTexto(doc, familia, p.trecho, texto.replace(/\s+$/, ""))
      const yLinha = linhaBase + p.trecho.tamanho * 0.12
      doc.setLineWidth(Math.max(0.5, p.trecho.tamanho * 0.05))
      doc.line(x, yLinha, x + largura, yLinha)
    }

    x += (ultima ? medirSemEspacoFinal(doc, familia, p) : p.largura) + (/\s$/.test(p.texto) ? espacoExtra : 0)
  }
}

function medirSemEspacoFinal(
  doc: jsPDF,
  familia: "helvetica" | "times" | "courier",
  p: PalavraMedida,
): number {
  return larguraDoTexto(doc, familia, p.trecho, p.texto.replace(/\s+$/, ""))
}
