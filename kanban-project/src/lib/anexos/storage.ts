// src/lib/anexos/storage.ts
// ============================================================================
// STORAGE DOS ANEXOS (servidor): gravar SEMPRE no bucket PRIVADO, abrir só por URL assinada curta.
//
// REGRA DE OURO: anexo novo NUNCA vai para o bucket público. Se o bucket privado não está configurado (`R2_BUCKET_PRIVADO` ausente — modo
// único), a rota RECUSA gerar o envio (503) em vez de cair no público: melhor não anexar do que anexar aberto ao mundo.
// ============================================================================
import { PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"
import { randomUUID } from "crypto"
import { r2 } from "@/src/lib/r2"
import { configDosBuckets, bucketDeEscrita, type ConfigBuckets } from "@/src/lib/r2-buckets"
import { bucketOndeEsta, lerObjetoPrivado, urlAssinadaDeLeitura } from "@/src/lib/documentos/modelos/storage-privado"
import { novaChaveDeAnexo, leituraDoValor, type AlvoDoAnexo } from "./chave"
import { VALIDADE_DA_URL_DE_ANEXO_SEGUNDOS } from "./porta"

export class BucketPrivadoNaoConfigurado extends Error {
  constructor() { super("O bucket privado de anexos não está configurado (R2_BUCKET_PRIVADO). Nenhum anexo é gravado no bucket público.") }
}

/** PURA — o bucket onde o anexo é gravado. Lança se isso o colocaria no bucket PÚBLICO. */
export function bucketDoAnexoNovo(chave: string, cfg: ConfigBuckets): string {
  if (cfg.privado == null) throw new BucketPrivadoNaoConfigurado()
  const b = bucketDeEscrita(chave, cfg)
  if (b !== cfg.privado || b === cfg.publico) throw new BucketPrivadoNaoConfigurado()
  return b
}

const VALIDADE_DO_ENVIO_SEGUNDOS = 300

/** Gera a chave nova e a URL assinada de ENVIO (o navegador sobe direto para o bucket privado). */
export async function prepararEnvioDeAnexo(args: { alvo: AlvoDoAnexo; nome: string; tipo: string; tamanho: number }, cfg: ConfigBuckets = configDosBuckets()) {
  const chave = novaChaveDeAnexo({ alvo: args.alvo, nome: args.nome, uuid8: randomUUID().slice(0, 8) })
  const bucket = bucketDoAnexoNovo(chave, cfg)
  const uploadUrl = await getSignedUrl(r2, new PutObjectCommand({ Bucket: bucket, Key: chave, ContentType: args.tipo, ContentLength: args.tamanho }), { expiresIn: VALIDADE_DO_ENVIO_SEGUNDOS })
  return { chave, uploadUrl }
}

/** URL assinada de LEITURA (5 min). Só chamar DEPOIS de autorizar. */
export async function urlAssinadaDoAnexo(chave: string, nome: string, mime: string): Promise<{ url: string; expiraEmSegundos: number }> {
  const url = await urlAssinadaDeLeitura({ chave, nomeParaDownload: nome, mime, download: false })
  return { url, expiraEmSegundos: VALIDADE_DA_URL_DE_ANEXO_SEGUNDOS }
}

/**
 * Lê os BYTES de um anexo para uso do SERVIDOR (ex.: transcrição). Chave nova → bucket privado; endereço antigo/externo → `fetch` como antes.
 * Devolve `null` quando não dá para ler (o chamador conta o motivo).
 */
export async function lerBytesDoAnexo(valor: string): Promise<{ ok: true; conteudo: Uint8Array } | { ok: false; motivo: string }> {
  const l = leituraDoValor(valor)
  if (l.tipo === "vazio") return { ok: false, motivo: "Arquivo não informado." }
  try {
    if (l.tipo === "chave") return { ok: true, conteudo: new Uint8Array(await lerObjetoPrivado(l.chave)) }
    const res = await fetch(l.url)
    if (!res.ok) return { ok: false, motivo: `Não foi possível baixar o arquivo (HTTP ${res.status}).` }
    return { ok: true, conteudo: new Uint8Array(await res.arrayBuffer()) }
  } catch (e) {
    return { ok: false, motivo: `Falha ao baixar o arquivo: ${e instanceof Error ? e.message : String(e)}` }
  }
}

export { bucketOndeEsta, GetObjectCommand }
