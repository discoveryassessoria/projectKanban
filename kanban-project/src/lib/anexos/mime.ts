// src/lib/anexos/mime.ts
// ============================================================================
// O TIPO DO ARQUIVO ao abrir um anexo (08/10/2026). A tela de pré-visualização pedia a URL assinada SEM dizer o tipo e a porta assumia
// `application/octet-stream` — para o navegador isso é «arquivo genérico» e ele BAIXA em vez de mostrar (quadro em branco + download).
// Regra única: tipo informado e específico vale; senão o tipo sai da extensão do nome (ou da chave). Desconhecido continua genérico.
// Baixar só quando quem pediu mandou `baixar` — nunca por causa do tipo.
// ============================================================================
const POR_EXTENSAO: Record<string, string> = {
  pdf: "application/pdf",
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", heic: "image/heic", tif: "image/tiff", tiff: "image/tiff",
  txt: "text/plain",
  doc: "application/msword", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
}
export const TIPO_GENERICO = "application/octet-stream"

export function mimeDoAnexo(args: { mime?: string | null; nome?: string | null; chave?: string | null }): string {
  const informado = (args.mime ?? "").trim().toLowerCase()
  if (informado && informado !== TIPO_GENERICO) return informado
  for (const texto of [args.nome, args.chave]) {
    const ext = /\.([a-z0-9]{2,5})$/i.exec((texto ?? "").trim())?.[1]?.toLowerCase()
    if (ext && POR_EXTENSAO[ext]) return POR_EXTENSAO[ext]
  }
  return TIPO_GENERICO
}
