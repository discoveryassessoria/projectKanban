// src/services/registral/ocr/tesseract-local.ts
//
// PROVEDOR 1.5 — OCR LOCAL, GRATUITO, SEM CREDENCIAL.
//
// Cobre o que a camada de texto não cobre (PDF escaneado, imagem) SEM depender de
// `OCR_ENDPOINT` externo — roda no próprio servidor, com Tesseract (open-source).
// Existe porque a maioria das certidões reais (Certidão em Inteiro Teor do e-CRC
// INCLUÍDA — apesar de "digital", a página inteira é uma imagem rasterizada por
// causa do padrão de segurança anti-fraude) não tem camada de texto útil, e sem
// isto ficavam TODAS dependendo de alguém configurar um serviço pago.
//
// RASTERIZAÇÃO EM PROCESSO NODE SEPARADO (scripts/ocr/rasterizar-pdf.mjs), de
// propósito: a camada de texto (`pdf-camada-texto.ts`) já carrega o pdfjs-dist 5.x
// no MESMO processo da aplicação. A versão que renderiza página inteira de
// certidão real sem quebrar no `canvas` nativo é a 3.11.174 (instalada à parte,
// sob o alias `pdfjs-dist-legado` — a 5.x quebra em `paintInlineImageXObject`
// nesse mesmo documento, achado real e reproduzido em 06/09/2026). As duas
// versões, coexistindo no MESMO processo, disputam a mesma infraestrutura interna
// de "worker" do pdfjs-dist e o handshake de versão API×Worker quebra ("The API
// version 3.11.174 does not match the Worker version 5.4.296"). Processo Node
// separado elimina esse conflito por completo — cada processo carrega uma só
// versão. O custo (subir um processo por documento) é aceitável: OCR já é a
// operação mais cara da cadeia.
//
// Línguas do OCR: português + espanhol por padrão — cobre a maioria dos
// documentos deste sistema (Registro Civil brasileiro + o "documento base" do
// ascendente estrangeiro, que aqui tem sido espanhol). Ampliar depois é só mudar
// IDIOMAS.

import { spawn } from "child_process"
import { mkdtemp, readFile, rm, writeFile } from "fs/promises"
import { tmpdir } from "os"
import { join } from "path"
import type {
  ArquivoParaTranscrever,
  PaginaTranscrita,
  ProvedorTranscricao,
  ResultadoTranscricao,
} from "./tipos"
import { ehImagem, ehPdf, textoUtil } from "./tipos"

const IDIOMAS = "por+spa"
const TIMEOUT_RASTER_MS = 90_000

/**
 * Caminho do script de rasterização. Em produção (Vercel), `outputFileTracingIncludes`
 * (ver next.config.ts) garante que `scripts/ocr/rasterizar-pdf.mjs` e suas
 * dependências (canvas, pdfjs-dist-legado) entram no bundle da função — sem isso o
 * `spawn` abaixo não acharia o arquivo em runtime (referência só em tempo de
 * execução não é rastreada como import estático).
 */
function caminhoDoScriptDeRasterizacao(): string {
  return join(process.cwd(), "scripts", "ocr", "rasterizar-pdf.mjs")
}

/** Roda o script de rasterização num processo Node separado e devolve os PNGs gerados. */
async function renderizarPaginasComoPng(conteudo: Uint8Array): Promise<Buffer[]> {
  const dir = await mkdtemp(join(tmpdir(), "ocr-raster-"))
  const caminhoPdf = join(dir, "documento.pdf")
  try {
    await writeFile(caminhoPdf, conteudo)

    const totalPaginas = await new Promise<number>((resolve, reject) => {
      const proc = spawn(process.execPath, [caminhoDoScriptDeRasterizacao(), caminhoPdf, dir], {
        stdio: ["ignore", "pipe", "pipe"],
      })
      let saida = ""
      let erro = ""
      const prazo = setTimeout(() => {
        proc.kill("SIGKILL")
        reject(new Error(`Rasterização não terminou em ${TIMEOUT_RASTER_MS / 1000}s.`))
      }, TIMEOUT_RASTER_MS)
      proc.stdout.on("data", (d) => { saida += String(d) })
      proc.stderr.on("data", (d) => { erro += String(d) })
      proc.on("error", (e) => { clearTimeout(prazo); reject(e) })
      proc.on("close", (code) => {
        clearTimeout(prazo)
        if (code !== 0) {
          reject(new Error(`Rasterização terminou com código ${code}: ${erro.trim() || "sem detalhe"}`))
          return
        }
        const n = Number.parseInt(saida.trim(), 10)
        if (!Number.isFinite(n) || n <= 0) {
          reject(new Error(`Rasterização não devolveu número de páginas válido: "${saida.trim()}"`))
          return
        }
        resolve(n)
      })
    })

    const pngs: Buffer[] = []
    for (let n = 1; n <= totalPaginas; n++) {
      pngs.push(await readFile(join(dir, `pagina-${n}.png`)))
    }
    return pngs
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {
      // Best-effort: falha ao limpar o temp não pode derrubar uma extração que já deu certo.
    })
  }
}

export const provedorTesseractLocal: ProvedorTranscricao = {
  nome: "tesseract_local",
  // Depois da camada de texto (grátis e instantânea quando serve) e ANTES do OCR
  // externo pago — este também é grátis, só mais lento.
  prioridade: 15,

  suporta(arquivo) {
    return ehPdf(arquivo) || ehImagem(arquivo)
  },

  disponivel() {
    return { ok: true }
  },

  async transcrever(arquivo: ArquivoParaTranscrever): Promise<ResultadoTranscricao> {
    try {
      const imagens = ehPdf(arquivo)
        ? await renderizarPaginasComoPng(arquivo.conteudo)
        : [Buffer.from(arquivo.conteudo)]

      if (imagens.length === 0) {
        return { ok: false, provedor: this.nome, paginas: [], caracteres: 0, motivo: "PDF sem páginas pra reconhecer." }
      }

      const { createWorker } = await import("tesseract.js")
      // Sem isto, o Tesseract baixa o `.traineddata` de cada idioma pro diretório
      // de trabalho atual — em produção (Vercel) esse filesystem é SOMENTE
      // LEITURA fora de /tmp, e a primeira chamada quebraria silenciosamente ao
      // tentar gravar ali. Achado real testando localmente (06/09/2026): os
      // arquivos de idioma foram parar na raiz do repositório.
      const worker = await createWorker(IDIOMAS, undefined, { cachePath: tmpdir() })
      const paginas: PaginaTranscrita[] = []
      try {
        for (let i = 0; i < imagens.length; i++) {
          const { data } = await worker.recognize(imagens[i])
          const texto = (data.text || "").trim()
          if (texto) paginas.push({ pagina: i + 1, texto })
        }
      } finally {
        await worker.terminate()
      }

      const caracteres = textoUtil(paginas)
      if (caracteres === 0) {
        return { ok: false, provedor: this.nome, paginas: [], caracteres: 0, motivo: "OCR não reconheceu texto nas páginas renderizadas." }
      }
      return { ok: true, provedor: this.nome, paginas, caracteres, motivo: null }
    } catch (e) {
      return {
        ok: false,
        provedor: this.nome,
        paginas: [],
        caracteres: 0,
        motivo: `Falha no OCR local: ${e instanceof Error ? e.message : String(e)}`,
      }
    }
  },
}
