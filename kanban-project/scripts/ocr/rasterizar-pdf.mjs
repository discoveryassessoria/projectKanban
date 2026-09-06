// scripts/ocr/rasterizar-pdf.mjs
//
// Processo Node ISOLADO — roda a rasterização do PDF (pdfjs-dist-legado + canvas)
// numa instância de Node separada da aplicação principal.
//
// POR QUÊ ISOLADO: o pdf-camada-texto.ts (provedor 1) já carrega o pdfjs-dist 5.x
// no mesmo processo. O 3.11.174 (aliado como pdfjs-dist-legado — é a versão testada
// e comprovada compatível com o `canvas` nativo para render de página completa,
// achado real em 06/09/2026) e o 5.x compartilham infraestrutura interna de
// "worker" quando coexistem no MESMO processo Node, e o handshake de versão entre
// API e Worker quebra ("The API version 3.11.174 does not match the Worker version
// 5.4.296") — os dois pacotes brigam por um singleton global. Rodar em processo
// separado elimina o conflito por completo: cada processo só carrega UMA versão.
//
// Uso: node rasterizar-pdf.mjs <caminho-do-pdf> <diretorio-de-saida>
// Escreve <diretorio-de-saida>/pagina-1.png, pagina-2.png, ... e devolve o total de
// páginas renderizadas em stdout (uma linha, só o número) — sem nada mais.

import { readFileSync } from "fs"
import { join } from "path"

const [, , caminhoPdf, dirSaida] = process.argv
if (!caminhoPdf || !dirSaida) {
  console.error("uso: node rasterizar-pdf.mjs <pdf> <dir-saida>")
  process.exit(2)
}

const MAX_PAGINAS = 5
const ESCALA = 2.5

const canvasPkg = await import("canvas")
globalThis.Image = canvasPkg.Image
globalThis.ImageData = canvasPkg.ImageData

const { createRequire } = await import("module")
const require = createRequire(import.meta.url)
const pdfjs = require("pdfjs-dist-legado/legacy/build/pdf.js")

class FabricaDeCanvas {
  create(width, height) {
    const canvas = canvasPkg.createCanvas(width, height)
    return { canvas, context: canvas.getContext("2d") }
  }
  reset(entry, width, height) {
    entry.canvas.width = width
    entry.canvas.height = height
  }
  destroy(entry) {
    entry.canvas.width = 0
    entry.canvas.height = 0
    entry.canvas = null
    entry.context = null
  }
}

const bytes = new Uint8Array(readFileSync(caminhoPdf))
const fabrica = new FabricaDeCanvas()
const doc = await pdfjs.getDocument({
  data: bytes,
  useSystemFonts: true,
  isEvalSupported: false,
  canvasFactory: fabrica,
}).promise

// LIMIAR DE BINARIZAÇÃO — a Certidão em Inteiro Teor do e-CRC tem um padrão de
// segurança anti-fraude (fundo em crosshatch verde/amarelo) sobre a página
// inteira, inclusive por cima do texto. Achado real (06/09/2026): esse fundo
// COLORIDO confunde o Tesseract mesmo com a imagem nítida — ele tenta ler o
// padrão junto com a letra e devolve lixo. O texto de verdade é sempre preto; o
// padrão de segurança nunca é. Convertendo pra escala de cinza e cortando tudo
// que não é bem escuro, o padrão desaparece e só sobra o texto — binarização
// clássica de OCR sobre marca d'água, não é acaso.
const LIMIAR_ESCURO = 140

function binarizar(context, width, height) {
  const imageData = context.getImageData(0, 0, width, height)
  const d = imageData.data
  for (let i = 0; i < d.length; i += 4) {
    const cinza = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]
    const v = cinza < LIMIAR_ESCURO ? 0 : 255
    d[i] = d[i + 1] = d[i + 2] = v
  }
  context.putImageData(imageData, 0, 0)
}

const total = Math.min(doc.numPages, MAX_PAGINAS)
for (let n = 1; n <= total; n++) {
  const pagina = await doc.getPage(n)
  const viewport = pagina.getViewport({ scale: ESCALA })
  const { canvas, context } = fabrica.create(Math.ceil(viewport.width), Math.ceil(viewport.height))
  await pagina.render({ canvasContext: context, viewport, canvasFactory: fabrica }).promise
  binarizar(context, canvas.width, canvas.height)
  const png = canvas.toBuffer("image/png")
  const fs = await import("fs")
  fs.writeFileSync(join(dirSaida, `pagina-${n}.png`), png)
  pagina.cleanup?.()
}
await doc.destroy()

console.log(String(total))
