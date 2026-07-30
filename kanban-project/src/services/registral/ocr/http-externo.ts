// src/services/registral/ocr/http-externo.ts
//
// PROVEDOR 2 — OCR EXTERNO por HTTP.
//
// Cobre o que a camada de texto não cobre: certidão ESCANEADA (imagem, ou PDF que
// é só imagem). Isso exige OCR de verdade, que é um serviço externo ao Discovery.
//
// O provedor é genérico de propósito — fala com qualquer serviço que aceite o
// arquivo e devolva texto. Configuração por ambiente:
//
//   OCR_ENDPOINT   URL do serviço (obrigatória para ligar o provedor)
//   OCR_API_KEY    enviada em `Authorization: Bearer` (opcional)
//   OCR_TIMEOUT_MS tempo máximo por documento (padrão 60s)
//
// Sem `OCR_ENDPOINT` o provedor se declara INDISPONÍVEL, com motivo. Ele não
// inventa texto, não devolve vazio fingindo sucesso e não derruba o pipeline: o
// documento segue para DOCUMENTO_INSUFICIENTE com a razão registrada na trilha.
//
// Formatos de resposta aceitos (os três que os serviços de OCR usam na prática):
//   { paginas: [{ pagina, texto }] }   ·   { pages: [{ page, text }] }   ·   { texto | text: "…" }

import type {
  ArquivoParaTranscrever,
  PaginaTranscrita,
  ProvedorTranscricao,
  ResultadoTranscricao,
} from "./tipos"
import { ehImagem, ehPdf, textoUtil } from "./tipos"

const TIMEOUT_PADRAO_MS = 60_000

function endpoint(): string {
  return (process.env.OCR_ENDPOINT ?? "").trim()
}

/** Normaliza as três formas de resposta num único formato. */
export function normalizarResposta(corpo: unknown): PaginaTranscrita[] {
  if (!corpo || typeof corpo !== "object") return []
  const o = corpo as Record<string, unknown>

  const lista = Array.isArray(o.paginas) ? o.paginas : Array.isArray(o.pages) ? o.pages : null
  if (lista) {
    const out: PaginaTranscrita[] = []
    for (const item of lista) {
      if (!item || typeof item !== "object") continue
      const r = item as Record<string, unknown>
      const texto = String(r.texto ?? r.text ?? "")
      if (!texto.trim()) continue
      const n = Number(r.pagina ?? r.page ?? out.length + 1)
      out.push({ pagina: Number.isFinite(n) && n > 0 ? n : out.length + 1, texto })
    }
    return out.sort((a, b) => a.pagina - b.pagina)
  }

  const plano = String(o.texto ?? o.text ?? "")
  return plano.trim() ? [{ pagina: 1, texto: plano }] : []
}

export const provedorOcrExterno: ProvedorTranscricao = {
  nome: "ocr_externo",
  prioridade: 20,

  suporta(arquivo) {
    // Serve tanto para imagem quanto para PDF escaneado — por isso aceita os dois.
    return ehImagem(arquivo) || ehPdf(arquivo)
  },

  disponivel() {
    if (!endpoint()) {
      return {
        ok: false,
        motivo:
          "OCR externo não configurado (defina OCR_ENDPOINT, e OCR_API_KEY se o serviço exigir). Documento escaneado fica sem transcrição até isso ser feito.",
      }
    }
    return { ok: true }
  },

  async transcrever(arquivo: ArquivoParaTranscrever): Promise<ResultadoTranscricao> {
    const url = endpoint()
    if (!url) {
      return { ok: false, provedor: this.nome, paginas: [], caracteres: 0, motivo: "OCR_ENDPOINT ausente." }
    }

    const limite = Number(process.env.OCR_TIMEOUT_MS ?? TIMEOUT_PADRAO_MS)
    const controlador = new AbortController()
    const timer = setTimeout(() => controlador.abort(), Number.isFinite(limite) && limite > 0 ? limite : TIMEOUT_PADRAO_MS)

    try {
      const form = new FormData()
      form.append(
        "arquivo",
        new Blob([arquivo.conteudo as BlobPart], { type: arquivo.mimeType ?? "application/octet-stream" }),
        arquivo.nome ?? `documento-${arquivo.documentoId}`,
      )
      form.append("documentoId", String(arquivo.documentoId))
      form.append("idioma", "por")

      const chave = (process.env.OCR_API_KEY ?? "").trim()
      const res = await fetch(url, {
        method: "POST",
        body: form,
        headers: chave ? { Authorization: `Bearer ${chave}` } : undefined,
        signal: controlador.signal,
      })

      if (!res.ok) {
        const detalhe = await res.text().catch(() => "")
        return {
          ok: false,
          provedor: this.nome,
          paginas: [],
          caracteres: 0,
          motivo: `OCR externo respondeu ${res.status}${detalhe ? `: ${detalhe.slice(0, 200)}` : ""}`,
        }
      }

      const corpo = await res.json().catch(() => null)
      const paginas = normalizarResposta(corpo)
      const caracteres = textoUtil(paginas)

      if (!caracteres) {
        return {
          ok: false,
          provedor: this.nome,
          paginas: [],
          caracteres: 0,
          motivo: "OCR externo respondeu sem texto utilizável.",
        }
      }
      return { ok: true, provedor: this.nome, paginas, caracteres, motivo: null }
    } catch (e) {
      const abortado = e instanceof Error && e.name === "AbortError"
      return {
        ok: false,
        provedor: this.nome,
        paginas: [],
        caracteres: 0,
        motivo: abortado
          ? `OCR externo excedeu o tempo limite (${limite}ms).`
          : `Falha ao chamar o OCR externo: ${e instanceof Error ? e.message : String(e)}`,
      }
    } finally {
      clearTimeout(timer)
    }
  },
}
