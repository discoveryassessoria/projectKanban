// src/lib/documentos/modelos/storage-privado.ts
//
// STORAGE DOS DOCUMENTOS GERADOS E DOS TEMPLATES (e, via `storage-coleta.ts`, dos arquivos da coleta).
//
// Estes arquivos carregam CPF, RG e endereço residencial. O banco guarda só a CHAVE do objeto e a
// única forma de chegar ao binário é uma URL assinada de curta duração, emitida por rota autenticada
// que confere a autorização antes de assinar.
//
// ⚠ O PREFIXO `privado/` NÃO É UMA BARREIRA. O endereço público do bucket (`R2_PUBLIC_URL`) serve o
// bucket INTEIRO: um objeto em `privado/...` abre sem autenticação se alguém tiver o endereço (achado
// no teste real de 04/10/2026). A privacidade de verdade vem de um BUCKET SEPARADO, sem endereço
// público (`R2_BUCKET_PRIVADO`) — quando a variável existe, é ele que guarda tudo que começa com
// `privado/` (regra em `src/lib/r2-buckets.ts`). Enquanto a variável não existir, o sistema funciona
// como sempre e estes arquivos continuam no bucket público.
//
// POR QUE NÃO REAPROVEITAR O UPLOAD COMUM: o fluxo de anexos usa presign de escrita pelo navegador e
// devolve `R2_PUBLIC_URL/<key>` — endereço adivinhável, servido sem autenticação. Correto para o que
// ele faz; inaceitável para uma procuração. Aqui o binário nasce NO SERVIDOR (nunca sobe pelo
// navegador) e sai só assinado.

import { PutObjectCommand, GetObjectCommand, DeleteObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"
import { createHash, randomUUID } from "crypto"
import { r2, R2_BUCKET } from "@/src/lib/r2"
import { bucketDeEscrita, bucketsDeLeitura, configDosBuckets, modoDuploParaChave } from "@/src/lib/r2-buckets"

/** Prefixo dedicado. É só um NOME: a privacidade vem do bucket privado (`R2_BUCKET_PRIVADO`), não do prefixo. */
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
      Bucket: bucketDaEscrita(chave),
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
  const buckets = bucketsDeLeituraDaChave(chave)
  let ultimoErro: unknown = null
  for (let i = 0; i < buckets.length; i++) {
    try {
      const saida = await r2.send(new GetObjectCommand({ Bucket: buckets[i], Key: chave }))
      if (i > 0) registrarLeituraNoBucketAntigo(chave)
      const corpo = saida.Body as unknown as { transformToByteArray(): Promise<Uint8Array> }
      return Buffer.from(await corpo.transformToByteArray())
    } catch (e) {
      ultimoErro = e
      if (!ehObjetoInexistente(e) || i === buckets.length - 1) throw e
    }
  }
  throw ultimoErro
}

/**
 * Remove um objeto do storage privado.
 *
 * Só é chamada como COMPENSAÇÃO: quando a transação que daria dono ao binário
 * falha, o binário recém-subido não pertence a registro nenhum. Nunca apaga
 * arquivo de versão existente — versão gerada é histórico e não se apaga.
 */
export async function removerObjetoPrivado(chave: string): Promise<void> {
  // Só no bucket de ESCRITA da chave. Nenhum fluxo do sistema apaga do bucket público o que o modo duplo
  // deixou lá como plano B — isso é um ato separado, com autorização explícita.
  await r2.send(new DeleteObjectCommand({ Bucket: bucketDaEscrita(chave), Key: chave }))
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
    Bucket: await bucketOndeEsta(args.chave),
    Key: args.chave,
    ResponseContentType: args.mime,
    ResponseContentDisposition: `${disposicao}; filename="${nomeSeguro(args.nomeParaDownload)}"`,
  })
  return getSignedUrl(r2, comando, { expiresIn: VALIDADE_URL_ASSINADA })
}


// ── QUAL BUCKET (modo único × modo duplo) ───────────────────────────────────

/** Bucket onde a chave é gravada/apagada. Modo único: o de sempre. */
export function bucketDaEscrita(chave: string): string {
  const cfg = configDosBuckets()
  return bucketDeEscrita(chave, { ...cfg, publico: cfg.publico || R2_BUCKET })
}

function bucketsDeLeituraDaChave(chave: string): string[] {
  const cfg = configDosBuckets()
  return bucketsDeLeitura(chave, { ...cfg, publico: cfg.publico || R2_BUCKET })
}

/** Erro "o objeto não existe" do S3/R2 (não confundir com falta de permissão ou de rede). */
export function ehObjetoInexistente(e: unknown): boolean {
  const x = e as { name?: string; Code?: string; $metadata?: { httpStatusCode?: number } } | null
  return x?.name === "NoSuchKey" || x?.name === "NotFound" || x?.Code === "NoSuchKey" || x?.$metadata?.httpStatusCode === 404
}

/**
 * Em qual bucket o objeto está AGORA. Modo único: o de sempre, SEM nenhuma chamada ao storage (nada muda
 * em produção). Modo duplo: o bucket novo se o objeto já está lá; senão o antigo (plano B) — e cada
 * leitura que cai no antigo é registrada no log, para sabermos quando a cópia cobre tudo.
 */
export async function bucketOndeEsta(chave: string): Promise<string> {
  const buckets = bucketsDeLeituraDaChave(chave)
  if (buckets.length === 1) return buckets[0]
  for (let i = 0; i < buckets.length; i++) {
    try {
      await r2.send(new HeadObjectCommand({ Bucket: buckets[i], Key: chave }))
      if (i > 0) registrarLeituraNoBucketAntigo(chave)
      return buckets[i]
    } catch (e) {
      if (!ehObjetoInexistente(e)) throw e
    }
  }
  // Não está em nenhum: assina contra o bucket novo (o navegador receberá 404 do storage, como antes).
  return buckets[0]
}

/** Uma linha por leitura que ainda depende do bucket antigo. Sem nome de arquivo: só a pasta e um sinal da chave. */
function registrarLeituraNoBucketAntigo(chave: string): void {
  const pasta = chave.split("/").slice(0, 3).join("/")
  console.warn(`[r2] LEITURA_NO_BUCKET_ANTIGO pasta=${pasta} chave#${createHash("sha1").update(chave).digest("hex").slice(0, 8)}`)
}

/** O objeto existe em algum dos buckets de leitura? (conferência dos arquivos enviados pela coleta) */
export async function existeObjetoPrivado(chave: string): Promise<{ bucket: string; tamanho: number | undefined; mime: string | undefined } | null> {
  const buckets = bucketsDeLeituraDaChave(chave)
  for (let i = 0; i < buckets.length; i++) {
    try {
      const h = await r2.send(new HeadObjectCommand({ Bucket: buckets[i], Key: chave }))
      if (i > 0) registrarLeituraNoBucketAntigo(chave)
      return { bucket: buckets[i], tamanho: h.ContentLength, mime: h.ContentType }
    } catch (e) {
      if (!ehObjetoInexistente(e)) throw e
    }
  }
  return null
}

export { modoDuploParaChave }
