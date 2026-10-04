// src/services/coleta/storage-coleta.ts
// ============================================================================
// STORAGE PRIVADO DA COLETA — arquivos que o cliente envia pelo link público.
//
// Mesmo padrão dos documentos gerados (`storage-privado.ts`): prefixo `privado/`, o banco guarda SÓ a chave e a
// leitura é por URL assinada de curta duração emitida depois de autorizar. ⚠ O prefixo, sozinho, NÃO impede o
// acesso pelo endereço público do bucket: a privacidade vem do bucket separado `R2_BUCKET_PRIVADO` (modo duplo,
// ver `src/lib/r2-buckets.ts`). Sem a variável, tudo continua no bucket de sempre.
//
// O envio é DIRETO do navegador por URL assinada de escrita (o corpo não passa
// pela função serverless, que limita o payload). A chave é opaca (uuid) e nasce
// DENTRO da pasta do link — a confirmação do envio só aceita chave da pasta.
// ============================================================================

import { PutObjectCommand, GetObjectCommand, CopyObjectCommand } from "@aws-sdk/client-s3"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"
import { randomUUID } from "crypto"
import { r2, R2_BUCKET, R2_PUBLIC_URL } from "@/src/lib/r2"
import {
  bucketDaEscrita, bucketOndeEsta, existeObjetoPrivado, nomeSeguro, removerObjetoPrivado, urlAssinadaDeLeitura,
} from "@/src/lib/documentos/modelos/storage-privado"

export const PREFIXO_COLETA = "privado/coleta"
/** Validade da URL de envio: o cliente sobe o arquivo logo após escolher. */
const VALIDADE_UPLOAD = 300

export const pastaDoLink = (linkId: number) => `${PREFIXO_COLETA}/${linkId}/`

/** A chave pertence à pasta deste link? (impede enviar chave de outro link/outro prefixo) */
export const chaveDoLink = (linkId: number, chave: string) =>
  typeof chave === "string" && chave.startsWith(pastaDoLink(linkId)) && !chave.includes("..") && chave.length <= 300

export async function urlDeEnvioColeta(args: { linkId: number; nome: string; mime: string; tamanho: number }) {
  const chave = `${pastaDoLink(args.linkId)}${randomUUID()}/${nomeSeguro(args.nome) || "arquivo"}`
  const comando = new PutObjectCommand({ Bucket: bucketDaEscrita(chave), Key: chave, ContentType: args.mime, ContentLength: args.tamanho })
  const url = await getSignedUrl(r2, comando, { expiresIn: VALIDADE_UPLOAD })
  return { chave, url }
}

/** O objeto existe e tem o tamanho/tipo declarados? (o cliente não pode declarar uma coisa e subir outra) */
export async function conferirObjetoColeta(chave: string, tamanho: number, mime: string): Promise<boolean> {
  try {
    const h = await existeObjetoPrivado(chave)
    return h != null && h.tamanho === tamanho && (h.mime ?? "") === mime
  } catch {
    return false
  }
}

export async function urlDeLeituraColeta(chave: string, nome: string, mime: string): Promise<string> {
  return urlAssinadaDeLeitura({ chave, nomeParaDownload: nome, mime, download: false })
}

export async function apagarObjetoColeta(chave: string): Promise<void> {
  await removerObjetoPrivado(chave)
}

/**
 * CONFIRMAÇÃO: copia o arquivo para o padrão dos anexos de cliente (bucket PÚBLICO, endereço público —
 * pendência registrada no mandato §8) e devolve a URL. A cópia privada é apagada por quem chama, DEPOIS de
 * o anexo estar gravado. Origem = onde o objeto está agora (privado ou, no plano B, o antigo); destino =
 * sempre o bucket público. Entre buckets diferentes, tenta a cópia direta no storage e, se ela não for
 * aceita, lê e grava pelo servidor (arquivo de até 10 MB).
 */
export async function copiarParaAnexoDeCliente(chavePrivada: string, nome: string): Promise<{ key: string; url: string }> {
  const key = `contratantes/${Date.now()}-${randomUUID().slice(0, 8)}-${nomeSeguro(nome) || "arquivo"}`
  const destino = R2_BUCKET
  const origem = await bucketOndeEsta(chavePrivada)
  try {
    await r2.send(new CopyObjectCommand({ Bucket: destino, Key: key, CopySource: `${origem}/${chavePrivada}` }))
  } catch (e) {
    if (origem === destino) throw e
    const lido = await r2.send(new GetObjectCommand({ Bucket: origem, Key: chavePrivada }))
    const corpo = Buffer.from(await (lido.Body as unknown as { transformToByteArray(): Promise<Uint8Array> }).transformToByteArray())
    await r2.send(new PutObjectCommand({ Bucket: destino, Key: key, Body: corpo, ContentType: lido.ContentType, ContentLength: corpo.length }))
  }
  return { key, url: `${R2_PUBLIC_URL}/${key}` }
}
