// src/services/registral/ocr/pdf-camada-texto.ts
//
// PROVEDOR 1 — CAMADA DE TEXTO DO PDF.
//
// Certidão emitida por cartório online (e-CRC, Registro Civil, portais de
// consulado) chega como PDF DIGITAL: o texto já está lá, embutido. Não precisa de
// OCR nenhum, não precisa de serviço externo, não precisa de credencial — precisa
// só ler a camada de texto.
//
// Este provedor cobre esse caso, que na prática é a maioria das certidões
// recentes. O que ele NÃO cobre é PDF escaneado (imagem dentro do PDF), e aí ele
// diz isso em vez de devolver texto vazio: quem decide o próximo passo é o
// orquestrador, que tenta o provedor de OCR externo.
//
// Usa `pdfjs-dist` (já no projeto, via react-pdf), build legacy, que é a que roda
// em Node sem DOM.

import type {
  ArquivoParaTranscrever,
  PaginaTranscrita,
  ProvedorTranscricao,
  ResultadoTranscricao,
} from "./tipos"
import { ehPdf, textoUtil } from "./tipos"

/** Abaixo disto o PDF é, na prática, escaneado: a camada de texto não serve. */
const MINIMO_CARACTERES_UTEIS = 40

/** Teto de páginas lidas por documento — certidão não tem 500 páginas. */
const MAX_PAGINAS = 60

interface ItemTexto {
  str?: string
  transform?: number[]
}

export const provedorPdfCamadaTexto: ProvedorTranscricao = {
  nome: "pdf_camada_texto",
  prioridade: 10,

  suporta(arquivo) {
    return ehPdf(arquivo)
  },

  disponivel() {
    return { ok: true }
  },

  async transcrever(arquivo: ArquivoParaTranscrever): Promise<ResultadoTranscricao> {
    try {
      // Import dinâmico: a build legacy do pdfjs é pesada e só é carregada quando
      // há de fato um PDF para ler.
      const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs")
      // Sem worker: em Node o worker separado não traz ganho e complica o bundle.
      const doc = await pdfjs.getDocument({
        data: arquivo.conteudo,
        useSystemFonts: true,
        isEvalSupported: false,
      }).promise

      const total = Math.min(doc.numPages, MAX_PAGINAS)
      const paginas: PaginaTranscrita[] = []

      for (let n = 1; n <= total; n++) {
        const pagina = await doc.getPage(n)
        const conteudo = await pagina.getTextContent()
        const itens = (conteudo.items ?? []) as ItemTexto[]

        // Reconstrução por LINHA: o pdfjs devolve fragmentos soltos, e juntar tudo
        // com espaço destrói a separação entre rótulo e valor — que é justamente o
        // que a leitura por âncora usa. Agrupar pela coordenada Y recompõe a linha.
        const linhas = new Map<number, string[]>()
        for (const item of itens) {
          const texto = String(item.str ?? "")
          if (!texto) continue
          const y = Math.round((item.transform?.[5] ?? 0) * 2) / 2
          const atual = linhas.get(y)
          if (atual) atual.push(texto)
          else linhas.set(y, [texto])
        }

        const texto = [...linhas.entries()]
          .sort((a, b) => b[0] - a[0]) // topo → base
          .map(([, partes]) => partes.join(" ").replace(/\s+/g, " ").trim())
          .filter(Boolean)
          .join("\n")

        if (texto) paginas.push({ pagina: n, texto })
        pagina.cleanup()
      }

      await doc.destroy()

      const caracteres = textoUtil(paginas)
      if (caracteres < MINIMO_CARACTERES_UTEIS) {
        return {
          ok: false,
          provedor: this.nome,
          paginas: [],
          caracteres,
          motivo:
            doc.numPages > 0
              ? `PDF sem camada de texto útil (${caracteres} caracteres em ${doc.numPages} página(s)) — provavelmente escaneado, precisa de OCR.`
              : "PDF sem páginas legíveis.",
        }
      }

      return { ok: true, provedor: this.nome, paginas, caracteres, motivo: null }
    } catch (e) {
      return {
        ok: false,
        provedor: this.nome,
        paginas: [],
        caracteres: 0,
        motivo: `Falha ao ler o PDF: ${e instanceof Error ? e.message : String(e)}`,
      }
    }
  },
}
