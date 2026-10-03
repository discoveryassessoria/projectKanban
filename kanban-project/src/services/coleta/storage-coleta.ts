// src/services/coleta/storage-coleta.ts
// ============================================================================
// STORAGE PRIVADO DA COLETA — arquivos que o cliente envia pelo link público.
//
// Mesmo padrão dos documentos gerados (`storage-privado.ts`): prefixo `privado/`
// (nunca servido pelo domínio público do bucket), o banco guarda SÓ a chave, e a
// leitura é por URL assinada de curta duração emitida depois de autorizar.
//
// O envio é DIRETO do navegador por URL assinada de escrita (o corpo não passa
// pela função serverless, que limita o payload). A chave é opaca (uuid) e nasce
// DENTRO da pasta do link — a confirmação do envio só aceita chave da pasta.
// ============================================================================

import { PutObjectCommand, HeadObjectCommand, CopyObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"
import { randomUUID } from "crypto"
import { r2, R2_BUCKET, R2_PUBLIC_URL } from "@/src/lib/r2"
import { nomeSeguro, urlAssinadaDeLeitura } from "@/src/lib/documentos/modelos/storage-privado"

export const PREFIXO_COLETA = "privado/coleta"
/** Validade da URL de envio: o cliente sobe o arquivo logo após escolher. */
const VALIDADE_UPLOAD = 300

export const pastaDoLink = (linkId: number) => `${PREFIXO_COLETA}/${linkId}/`

/** A chave pertence à pasta deste link? (impede enviar chave de outro link/outro prefixo) */
export const chaveDoLink = (linkId: number, chave: string) =>
  typeof chave === "string" && chave.startsWith(pastaDoLink(linkId)) && !chave.includes("..") && chave.length <= 300

export async function urlDeEnvioColeta(args: { linkId: number; nome: string; mime: string; tamanho: number }) {
  const chave = `${pastaDoLink(args.linkId)}${randomUUID()}/${nomeSeguro(args.nome) || "arquivo"}`
  const comando = new PutObjectCommand({ Bucket: R2_BUCKET, Key: chave, ContentType: args.mime, ContentLength: args.tamanho })
  const url = await getSignedUrl(r2, comando, { expiresIn: VALIDADE_UPLOAD })
  return { chave, url }
}

/** O objeto existe e tem o tamanho/tipo declarados? (o cliente não pode declarar uma coisa e subir outra) */
export async function conferirObjetoColeta(chave: string, tamanho: number, mime: string): Promise<boolean> {
  try {
    const h = await r2.send(new HeadObjectCommand({ Bucket: R2_BUCKET, Key: chave }))
    return h.ContentLength === tamanho && (h.ContentType ?? "") === mime
  } catch {
    return false
  }
}

export async function urlDeLeituraColeta(chave: string, nome: string, mime: string): Promise<string> {
  return urlAssinadaDeLeitura({ chave, nomeParaDownload: nome, mime, download: false })
}

export async function apagarObjetoColeta(chave: string): Promise<void> {
  await r2.send(new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: chave }))
}

/**
 * CONFIRMAÇÃO: copia o arquivo para o padrão dos anexos de cliente (endereço público
 * — pendência registrada no mandato §8) e devolve a URL. A cópia privada é apagada
 * por quem chama, DEPOIS de o anexo estar gravado.
 */
export async function copiarParaAnexoDeCliente(chavePrivada: string, nome: string): Promise<{ key: string; url: string }> {
  const key = `contratantes/${Date.now()}-${randomUUID().slice(0, 8)}-${nomeSeguro(nome) || "arquivo"}`
  await r2.send(new CopyObjectCommand({ Bucket: R2_BUCKET, Key: key, CopySource: `${R2_BUCKET}/${chavePrivada}` }))
  return { key, url: `${R2_PUBLIC_URL}/${key}` }
}
