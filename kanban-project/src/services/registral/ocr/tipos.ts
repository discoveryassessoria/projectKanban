// src/services/registral/ocr/tipos.ts
//
// MRG — PORTA DE TRANSCRIÇÃO (o "OCR" do motor).
//
// O motor registral não lê arquivo: ele lê a TRANSCRIÇÃO gravada no Documento.
// Quem produz essa transcrição é um provedor, e provedor é plugável de propósito —
// o escritório pode trocar o serviço sem tocar em uma linha do motor.
//
// Contrato mínimo de um provedor:
//   · diz se sabe lidar com aquele tipo de arquivo;
//   · diz se está DISPONÍVEL agora (credencial configurada, dependência presente);
//   · devolve o texto POR PÁGINA — a página é o que a evidência cita.
//
// Nenhum provedor "finge": quando não consegue, devolve o motivo. Um provedor que
// devolvesse texto vazio silenciosamente faria o pipeline registrar "documento
// insuficiente" sem dizer que o problema foi a leitura.

export interface PaginaTranscrita {
  pagina: number
  texto: string
}

export interface ResultadoTranscricao {
  ok: boolean
  /** Nome do provedor que produziu (ou tentou produzir) o texto. */
  provedor: string
  paginas: PaginaTranscrita[]
  /** Quantos caracteres úteis saíram — 0 com ok=true significa documento em branco. */
  caracteres: number
  /** Motivo, quando não deu certo. Sempre preenchido em ok=false. */
  motivo: string | null
}

export interface ArquivoParaTranscrever {
  documentoId: number
  url: string
  nome: string | null
  mimeType: string | null
  conteudo: Uint8Array
}

export interface ProvedorTranscricao {
  /** Identificador curto — vai para `Documento.transcricaoFonte` e para a evidência. */
  readonly nome: string
  /** Ordem de tentativa: menor primeiro. */
  readonly prioridade: number
  /** Sabe lidar com este arquivo? */
  suporta(arquivo: { mimeType: string | null; nome: string | null }): boolean
  /** Está utilizável agora? (credencial, dependência) — motivo quando não. */
  disponivel(): { ok: true } | { ok: false; motivo: string }
  transcrever(arquivo: ArquivoParaTranscrever): Promise<ResultadoTranscricao>
}

/** Extensão em minúsculas, sem ponto. */
export function extensaoDe(nome: string | null, url?: string | null): string {
  const alvo = nome || url || ""
  const limpo = alvo.split("?")[0].split("#")[0]
  const i = limpo.lastIndexOf(".")
  return i >= 0 ? limpo.slice(i + 1).toLowerCase() : ""
}

export function ehPdf(a: { mimeType: string | null; nome: string | null }, url?: string | null): boolean {
  if ((a.mimeType ?? "").toLowerCase().includes("pdf")) return true
  return extensaoDe(a.nome, url) === "pdf"
}

export function ehImagem(a: { mimeType: string | null; nome: string | null }, url?: string | null): boolean {
  if ((a.mimeType ?? "").toLowerCase().startsWith("image/")) return true
  return ["png", "jpg", "jpeg", "tif", "tiff", "webp", "bmp"].includes(extensaoDe(a.nome, url))
}

/** Texto é "útil" quando tem conteúdo alfabético suficiente para extrair campo. */
export function textoUtil(paginas: PaginaTranscrita[]): number {
  return paginas.reduce((s, p) => s + p.texto.replace(/\s+/g, " ").trim().length, 0)
}
