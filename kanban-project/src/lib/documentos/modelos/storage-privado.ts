// src/lib/documentos/modelos/storage-privado.ts
//
// STORAGE PRIVADO DOS DOCUMENTOS GERADOS E DOS TEMPLATES.
//
// Estes arquivos carregam CPF, RG e endereço residencial. Eles nunca ganham URL
// pública: o que o banco guarda é a CHAVE do objeto, e a única forma de chegar
// ao binário é uma URL assinada de curta duração, emitida por rota autenticada
// que confere a autorização antes de assinar.
//
// POR QUE NÃO REAPROVEITAR O UPLOAD COMUM: o fluxo de anexos usa presign de
// escrita pelo navegador e devolve `R2_PUBLIC_URL/<key>` — endereço adivinhável,
// servido sem autenticação. Correto para o que ele faz; inaceitável para uma
// procuração. Aqui o binário nasce NO SERVIDOR (nunca sobe pelo navegador) e sai
// só assinado.

import { PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"
import { createHash, randomUUID } from "crypto"
import { r2, R2_BUCKET } from "@/src/lib/r2"

/** Prefixo dedicado. Nada aqui é servido pelo domínio público do bucket. */
export const PREFIXO_PRIVADO = "privado/documentos"

export const MIME_DOCX =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
export const MIME_PDF = "application/pdf"

/** Impressão digital do binário — a mesma convenção usada nos anexos. */
export function checksumDoBuffer(buffer: Buffer | Uint8Array): string {
  return `sha256:${createHash("sha256").update(buffer).digest("hex")}`
}

/**
 * Nome de arquivo seguro. Nunca inclui CPF, RG ou endereço: o caminho do objeto
 * não é lugar de dado pessoal, porque caminho aparece em log de storage.
 */
export function nomeSeguro(base: string): string {
  return base
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/_+/g, "_")
    .slice(0, 120)
}

export interface ObjetoPrivado {
  chave: string
  nome: string
  tamanho: number
  checksum: string
  mime: string
}

/**
 * Grava um binário no storage privado, do servidor.
 *
 * A chave é opaca (uuid), o que resolve duas coisas de uma vez: não vaza
 * identidade no caminho e não colide em retry — o registro de banco é que diz
 * qual chave pertence a qual versão.
 */
export async function gravarObjetoPrivado(args: {
  buffer: Buffer
  nomeVisivel: string
  mime: string
  /** Subpasta lógica (ex.: "templates", "gerados"). */
  pasta: string
}): Promise<ObjetoPrivado> {
  const nome = nomeSeguro(args.nomeVisivel)
  const chave = `${PREFIXO_PRIVADO}/${args.pasta}/${randomUUID()}/${nome}`

  await r2.send(
    new PutObjectCommand({
      Bucket: R2_BUCKET,
      Key: chave,
      Body: args.buffer,
      ContentType: args.mime,
      ContentLength: args.buffer.length,
    }),
  )

  return {
    chave,
    nome,
    tamanho: args.buffer.length,
    checksum: checksumDoBuffer(args.buffer),
    mime: args.mime,
  }
}

/** Lê o binário de volta — usado pelo motor de geração para abrir o template. */
export async function lerObjetoPrivado(chave: string): Promise<Buffer> {
  const saida = await r2.send(new GetObjectCommand({ Bucket: R2_BUCKET, Key: chave }))
  const corpo = saida.Body as unknown as { transformToByteArray(): Promise<Uint8Array> }
  return Buffer.from(await corpo.transformToByteArray())
}

/**
 * Remove um objeto do storage privado.
 *
 * Só é chamada como COMPENSAÇÃO: quando a transação que daria dono ao binário
 * falha, o binário recém-subido não pertence a registro nenhum. Nunca apaga
 * arquivo de versão existente — versão gerada é histórico e não se apaga.
 */
export async function removerObjetoPrivado(chave: string): Promise<void> {
  await r2.send(new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: chave }))
}

/** Segundos de validade da URL assinada. Curto de propósito: link não vira cópia. */
export const VALIDADE_URL_ASSINADA = 300

/**
 * URL assinada de leitura. Só é chamada DEPOIS da checagem de autorização —
 * assinar antes de autorizar seria entregar a chave e conferir a fechadura
 * depois.
 */
export async function urlAssinadaDeLeitura(args: {
  chave: string
  nomeParaDownload: string
  mime: string
  /** true = anexo (baixa); false = inline (abre no visualizador). */
  download: boolean
}): Promise<string> {
  const disposicao = args.download ? "attachment" : "inline"
  const comando = new GetObjectCommand({
    Bucket: R2_BUCKET,
    Key: args.chave,
    ResponseContentType: args.mime,
    ResponseContentDisposition: `${disposicao}; filename="${nomeSeguro(args.nomeParaDownload)}"`,
  })
  return getSignedUrl(r2, comando, { expiresIn: VALIDADE_URL_ASSINADA })
}
